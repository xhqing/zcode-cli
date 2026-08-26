import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { Readable } from "node:stream";

/**
 * Multi-key failover proxy.
 *
 * Keys are configured one variable per key: `ZCODE_API_KEY` holds the primary
 * key and optional numbered variables (`ZCODE_API_KEY_2`, `ZCODE_API_KEY_3`,
 * ...) hold backups. With more than one key the launcher binds this loopback
 * proxy before spawning the runtime and points the provider `baseURL` at it.
 * The runtime keeps talking to what it
 * believes is the real endpoint; the proxy forwards each request upstream with
 * the currently selected key and, whenever the upstream rejects that key
 * (401/403/429, 5xx, connection failure), retries the same request with the
 * next key before anything is sent back. A successful response is streamed to
 * the runtime untouched, so SSE model streams work as before.
 */

export const defaultFailoverPort = 7849;
const portAttempts = 20;
export const healthPath = "/__zcode_failover__";
/** Written into config.json in failover mode; the real keys never touch disk. */
export const placeholderApiKey = "zcode-failover";
const logSizeLimitBytes = 1024 * 1024;
const retryableStatuses = new Set([401, 403, 429]);
// Hop-by-hop headers (RFC 7231 + common proxies) never forwarded either way.
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
// Headers that describe the compressed/encoded transfer between proxy and
// upstream: undici's fetch transparently decompresses gzip/br bodies, so the
// runtime must not receive the stale encoding/length headers.
const droppedUpstreamHeaders = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive"
]);

/** Matches the numbered backup key variables, e.g. `ZCODE_API_KEY_2`. */
export const numberedApiKeyPattern = /^ZCODE_API_KEY_\d+$/u;

/**
 * Merges the API key variables into the ordered unique key list: the primary
 * `ZCODE_API_KEY` first, then numbered `ZCODE_API_KEY_<n>` entries by
 * ascending number. Each variable holds exactly one key.
 */
export function collectApiKeys(values: Readonly<Record<string, string | undefined>>): string[] {
  const keys: string[] = [];
  const push = (raw: string | undefined): void => {
    const key = raw?.trim();
    if (key && !keys.includes(key)) keys.push(key);
  };
  push(values.ZCODE_API_KEY);
  const numbered: Array<[number, string | undefined]> = [];
  for (const [name, value] of Object.entries(values)) {
    if (numberedApiKeyPattern.test(name)) numbered.push([Number(name.slice("ZCODE_API_KEY_".length)), value]);
  }
  numbered.sort((a, b) => a[0] - b[0]);
  for (const [, value] of numbered) push(value);
  return keys;
}

/** `abcd1234efgh` -> `abcd****efgh`; short values are fully masked. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function failoverLogPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fallbackHome: string = homedir()
): string {
  const path = platform === "win32" ? win32 : posix;
  const configuredHome = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim();
  return path.join(configuredHome || fallbackHome, ".zcode", "cli", "key-failover.log");
}

interface FailoverLog {
  path: string;
  writeFailed: boolean;
}

function appendLog(log: FailoverLog, line: string): void {
  if (log.writeFailed) return;
  try {
    if (!existsSync(log.path) || statSync(log.path).size < logSizeLimitBytes) {
      appendFileSync(log.path, line + "\n", { mode: 0o600 });
      return;
    }
    const rotated = `${log.path}.1`;
    if (existsSync(rotated)) return; // both slots full: drop oldest writes
    renameSync(log.path, rotated);
    appendFileSync(log.path, line + "\n", { mode: 0o600 });
  } catch {
    log.writeFailed = true;
  }
}

export interface KeyFailoverProxy {
  /** Loopback baseURL (origin + upstream path) to write into config.json. */
  baseURL: string;
  origin: string;
  port: number;
  close(): Promise<void>;
}

export interface KeyFailoverProxyOptions {
  /** Real upstream API root, e.g. `https://open.bigmodel.cn/api/anthropic`. */
  upstreamBaseURL: string;
  keys: string[];
  env?: NodeJS.ProcessEnv;
  /** Port to try first when binding; increments on conflict. */
  preferredPort?: number;
  logFile?: string;
  /** Injectable for tests; defaults to global fetch. */
  upstreamFetch?: typeof fetch;
}

function listen(server: Server, port: number, host = "127.0.0.1"): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function forwardHeaders(headers: IncomingMessage["headers"], apiKey: string): Record<string, string> {
  const outgoing: Record<string, string> = {};
  let authenticated = false;
  for (const [name, value] of Object.entries(headers)) {
    if (hopByHopHeaders.has(name) || name === "host" || name === "content-length") continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== "string") continue;
      if (name === "x-api-key" || name === "authorization") {
        if (!authenticated) {
          outgoing[name] = apiKey;
          authenticated = true;
        }
        continue;
      }
      // Multiple values of the same header collapse via comma joining, which
      // is what the anthropic/openai wire formats expect for repeats.
      outgoing[name] = outgoing[name] ? `${outgoing[name]},${item}` : item;
    }
  }
  if (!authenticated) outgoing["x-api-key"] = apiKey;
  return outgoing;
}

function retryableFailure(status: number): boolean {
  return retryableStatuses.has(status) || status >= 500;
}

function writeJsonHead(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(body);
}

interface UpstreamOutcome {
  kind: "response" | "error";
  status?: number;
  response?: Response;
  error?: unknown;
}

interface CapturedFailure {
  status: number;
  bodyText: string;
  headers: Headers;
}

async function drainResponse(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    // Body disposal is best effort; the connection is released either way.
    return "";
  }
}

function pipeResponse(response: ServerResponse, upstream: Response): void {
  const headers: Record<string, string> = {};
  upstream.headers.forEach((value, name) => {
    if (!droppedUpstreamHeaders.has(name)) headers[name] = value;
  });
  response.writeHead(upstream.status, headers);
  const stream = Readable.fromWeb(
    upstream.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>
  );
  // If the runtime disconnects mid-stream there is nobody left to serve.
  response.once("close", () => stream.destroy());
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

/**
 * Binds the loopback failover proxy. Port conflicts (another zcode instance or
 * an unrelated process) move to the next port; the chosen port is returned so
 * the caller can point config.json's provider baseURL at this proxy instance.
 */
export async function startKeyFailoverProxy(options: KeyFailoverProxyOptions): Promise<KeyFailoverProxy> {
  if (options.keys.length < 2) {
    throw new Error("key failover requires at least two API keys");
  }
  const upstream = new URL(options.upstreamBaseURL);
  const upstreamOrigin = upstream.origin;
  const upstreamPath = upstream.pathname.replace(/\/+$/u, "");

  const log: FailoverLog = {
    path: options.logFile ?? failoverLogPath(options.env ?? process.env),
    writeFailed: false
  };

  // Start position of the ring: subsequent requests begin from the key that
  // last succeeded, spreading load off keys that just failed.
  let cursor = 0;
  const doFetch = options.upstreamFetch ?? fetch;

  function createProxyServer(): Server {
    return createServer((request, response) => {
      void handleRequest(request, response).catch(() => {
        if (!response.headersSent) writeJsonHead(response, 502, JSON.stringify({ error: "failover proxy failure" }));
        else response.destroy();
      });
    });
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "GET" && request.url === healthPath) {
      writeJsonHead(response, 200, JSON.stringify({ service: "zcode-key-failover", keys: options.keys.length }));
      return;
    }
    const body = await readRequestBody(request);
    const method = request.method ?? "GET";
    const url = `${upstreamOrigin}${request.url ?? "/"}`;

    let lastFailure: CapturedFailure | undefined;
    for (let attempt = 0; attempt < options.keys.length; attempt += 1) {
      const keyIndex = (cursor + attempt) % options.keys.length;
      const apiKey = options.keys[keyIndex]!;
      let outcome: UpstreamOutcome;
      try {
        const upstreamResponse = await doFetch(url, {
          method,
          headers: forwardHeaders(request.headers, apiKey),
          body: body.byteLength > 0 ? new Uint8Array(body) : undefined,
          redirect: "manual"
        });
        outcome = { kind: "response", status: upstreamResponse.status, response: upstreamResponse };
      } catch (error) {
        outcome = { kind: "error", error };
      }

      if (outcome.kind === "error") {
        appendLog(
          log,
          `[${new Date().toISOString()}] ${method} ${upstreamPath} key#${keyIndex} (${maskKey(apiKey)}) network error, failover`
        );
        continue;
      }
      if (retryableFailure(outcome.status!)) {
        // Drain and capture: if this is the final attempt the captured body
        // is what the runtime receives once every key has failed.
        const bodyText = await drainResponse(outcome.response!);
        lastFailure = { status: outcome.status!, bodyText, headers: outcome.response!.headers };
        appendLog(
          log,
          `[${new Date().toISOString()}] ${method} ${upstreamPath} key#${keyIndex} (${maskKey(apiKey)}) -> ${outcome.status}, failover`
        );
        continue;
      }
      cursor = keyIndex;
      appendLog(log, `[${new Date().toISOString()}] ${method} ${upstreamPath} key#${keyIndex} (${maskKey(apiKey)}) -> ${outcome.status}`);
      pipeResponse(response, outcome.response!);
      return;
    }

    // Every key failed: hand back the last upstream answer (or a 502 when no
    // upstream was reachable at all) so the runtime's own retry logic and
    // error surfaces keep working unchanged.
    if (lastFailure) {
      appendLog(log, `[${new Date().toISOString()}] ${method} ${upstreamPath} all ${options.keys.length} keys failed -> ${lastFailure.status}`);
      const headers: Record<string, string> = {};
      lastFailure.headers.forEach((value, name) => {
        if (!droppedUpstreamHeaders.has(name)) headers[name] = value;
      });
      response.writeHead(lastFailure.status, headers);
      response.end(lastFailure.bodyText);
      return;
    }
    appendLog(log, `[${new Date().toISOString()}] ${method} ${upstreamPath} all ${options.keys.length} keys failed (network)`);
    writeJsonHead(response, 502, JSON.stringify({ error: "all API keys failed" }));
  }

  const firstPort = options.preferredPort ?? defaultFailoverPort;
  let server: Server | undefined;
  let port = firstPort;
  for (let offset = 0; offset < portAttempts && !server; offset += 1) {
    const candidate = createProxyServer();
    try {
      await listen(candidate, firstPort + offset);
      server = candidate;
      const address = candidate.address();
      port = typeof address === "object" && address !== null ? address.port : firstPort + offset;
    } catch {
      // Port busy: discard the socket and try the next one.
    }
  }
  if (!server) {
    throw new Error(`unable to bind the key failover proxy (tried ports ${firstPort}-${firstPort + portAttempts - 1})`);
  }

  appendLog(
    log,
    `[${new Date().toISOString()}] failover proxy listening on 127.0.0.1:${port} -> ${upstreamOrigin}${upstreamPath} with ${options.keys.length} keys`
  );

  const boundServer = server;
  return {
    origin: `http://127.0.0.1:${port}`,
    baseURL: `http://127.0.0.1:${port}${upstreamPath}`,
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        if (typeof boundServer.closeAllConnections === "function") boundServer.closeAllConnections();
        boundServer.close(() => resolve());
      });
    }
  };
}
