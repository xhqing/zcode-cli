import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectApiKeys,
  maskKey,
  placeholderApiKey,
  startKeyFailoverProxy,
  type KeyFailoverProxy
} from "../src/key-failover.ts";

const keys = ["aaaa1111bbbb", "cccc2222dddd", "eeee3333ffff"];
const upstreamRoot = "/api/anthropic";

interface UpstreamRecord {
  method: string;
  url: string;
  apiKey: string;
  body: string;
}

interface MockUpstream {
  server: Server;
  port: number;
  records: UpstreamRecord[];
  respond: (record: UpstreamRecord) => { status: number; body: string; streaming?: boolean };
  close(): Promise<void>;
}

const openServers: Array<{ close(): Promise<void> }> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close().catch(() => {})));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("mock upstream has no port");
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function startMockUpstream(
  respond: MockUpstream["respond"]
): Promise<MockUpstream> {
  const records: UpstreamRecord[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("end", () => {
      const record: UpstreamRecord = {
        method: request.method ?? "GET",
        url: request.url ?? "/",
        apiKey: String(request.headers["x-api-key"] ?? ""),
        body: Buffer.concat(chunks).toString("utf8")
      };
      records.push(record);
      const answer = respond(record);
      if (answer.streaming) {
        response.writeHead(answer.status, { "content-type": "text/event-stream" });
        response.write(answer.body);
        response.end();
        return;
      }
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(answer.body);
    });
  });
  const port = await listen(server);
  const upstream: MockUpstream = {
    server,
    port,
    records,
    respond,
    close: () => closeServer(server)
  };
  openServers.push({ close: upstream.close });
  return upstream;
}

interface ProxyFixture {
  proxy: KeyFailoverProxy;
  request(body: unknown, method?: string): Promise<Response>;
}

async function startFixture(respond: MockUpstream["respond"]): Promise<ProxyFixture & { upstream: MockUpstream }> {
  const upstream = await startMockUpstream(respond);
  const home = await mkdtemp(join(tmpdir(), "zcode-key-failover-"));
  temporaryDirectories.push(home);
  const proxy = await startKeyFailoverProxy({
    upstreamBaseURL: `http://127.0.0.1:${upstream.port}${upstreamRoot}`,
    keys,
    preferredPort: 0,
    logFile: join(home, "key-failover.log")
  });
  openServers.unshift({ close: proxy.close });
  return {
    upstream,
    proxy,
    request: (body: unknown, method = "POST") => fetch(
      `${proxy.baseURL}/v1/messages`,
      {
        method,
        headers: { "content-type": "application/json", "x-api-key": placeholderApiKey },
        body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body)
      }
    )
  };
}

describe("collectApiKeys", () => {
  test("merges the primary and numbered variables in ascending order", () => {
    expect(collectApiKeys({
      ZCODE_API_KEY_3: "k3",
      ZCODE_API_KEY: " k1 ",
      ZCODE_API_KEY_2: "k2"
    })).toEqual(["k1", "k2", "k3"]);
  });

  test("drops empties and duplicates, tolerates gaps", () => {
    expect(collectApiKeys({
      ZCODE_API_KEY: "k1",
      ZCODE_API_KEY_2: "k1",
      ZCODE_API_KEY_5: "  ",
      ZCODE_API_KEY_9: "k9"
    })).toEqual(["k1", "k9"]);
  });

  test("works with only numbered keys or no keys at all", () => {
    expect(collectApiKeys({ ZCODE_API_KEY_2: "k2" })).toEqual(["k2"]);
    expect(collectApiKeys({ ZCODE_API_KEY: "" })).toEqual([]);
    expect(collectApiKeys({})).toEqual([]);
  });
});

describe("maskKey", () => {
  test("keeps first and last four characters", () => {
    expect(maskKey("abcd1234efgh")).toBe("abcd****efgh");
    expect(maskKey("short")).toBe("****");
  });
});

describe("key failover proxy", () => {
  test("switches to the next key on 401 and remembers the healthy key", async () => {
    const fixture = await startFixture((record) => (
      record.apiKey === keys[0]
        ? { status: 401, body: '{"error":"invalid key"}' }
        : { status: 200, body: '{"ok":true}' }
    ));

    const first = await fixture.request({ model: "glm-5.2" });
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('{"ok":true}');
    // First request: key#0 rejected, key#1 answered.
    expect(fixture.upstream.records.map((record) => record.apiKey)).toEqual([keys[0], keys[1]]);
    // Both upstream calls carry the request body and path.
    expect(fixture.upstream.records.every((record) => record.url === `${upstreamRoot}/v1/messages`)).toBe(true);
    expect(fixture.upstream.records.every((record) => record.body === '{"model":"glm-5.2"}')).toBe(true);

    // Second request starts straight from the remembered healthy key.
    fixture.upstream.records.length = 0;
    const second = await fixture.request({ model: "glm-5.2" });
    expect(second.status).toBe(200);
    expect(fixture.upstream.records.map((record) => record.apiKey)).toEqual([keys[1]]);
  });

  test("returns the last upstream answer when every key fails", async () => {
    const fixture = await startFixture(() => ({ status: 429, body: '{"error":"rate limited"}' }));

    const response = await fixture.request({ model: "glm-5.2" });
    expect(response.status).toBe(429);
    expect(await response.text()).toBe('{"error":"rate limited"}');
    expect(fixture.upstream.records).toHaveLength(keys.length);
  });

  test("answers 502 when the upstream is unreachable", async () => {
    // Bind a port, note it, release it: nothing listens there afterwards.
    const ghost = createServer(() => {});
    const ghostPort = await listen(ghost);
    await closeServer(ghost);

    const home = await mkdtemp(join(tmpdir(), "zcode-key-failover-"));
    temporaryDirectories.push(home);
    const proxy = await startKeyFailoverProxy({
      upstreamBaseURL: `http://127.0.0.1:${ghostPort}${upstreamRoot}`,
      keys,
      preferredPort: 0,
      logFile: join(home, "key-failover.log")
    });
    openServers.push({ close: proxy.close });

    const response = await fetch(`${proxy.baseURL}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": placeholderApiKey },
      body: "{}"
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("all API keys failed");
  });

  test("passes client errors through without switching keys", async () => {
    const fixture = await startFixture(() => ({ status: 400, body: '{"error":"bad request"}' }));

    const response = await fixture.request({ model: "glm-5.2" });
    expect(response.status).toBe(400);
    expect(fixture.upstream.records).toHaveLength(1);
  });

  test("streams successful responses untouched", async () => {
    const fixture = await startFixture(() => ({
      status: 200,
      body: 'data: {"delta":"hello"}\n\ndata: {"delta":"world"}\n\n',
      streaming: true
    }));

    const response = await fixture.request({ model: "glm-5.2" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe('data: {"delta":"hello"}\n\ndata: {"delta":"world"}\n\n');
  });

  test("replaces the placeholder credentials with the active key", async () => {
    const fixture = await startFixture(() => ({ status: 200, body: "{}" }));

    await fixture.request({ model: "glm-5.2" });
    const sent = fixture.upstream.records[0]!;
    expect(sent.apiKey).toBe(keys[0]);
    expect(sent.apiKey).not.toBe(placeholderApiKey);
  });

  test("exposes a health endpoint", async () => {
    const fixture = await startFixture(() => ({ status: 200, body: "{}" }));

    const response = await fetch(`${fixture.proxy.origin}/__zcode_failover__`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "zcode-key-failover", keys: keys.length });
  });

  test("moves to the next port when the preferred one is busy", async () => {
    const blocker = createServer(() => {});
    const blockerPort = await listen(blocker);
    openServers.push({ close: () => closeServer(blocker) });

    const home = await mkdtemp(join(tmpdir(), "zcode-key-failover-"));
    temporaryDirectories.push(home);
    const proxy = await startKeyFailoverProxy({
      upstreamBaseURL: `http://127.0.0.1:${blockerPort}${upstreamRoot}`,
      keys,
      preferredPort: blockerPort,
      logFile: join(home, "key-failover.log")
    });
    openServers.push({ close: proxy.close });
    expect(proxy.port).toBe(blockerPort + 1);
    expect(proxy.baseURL).toBe(`http://127.0.0.1:${blockerPort + 1}${upstreamRoot}`);
  });

  test("requires at least two keys", async () => {
    await expect(startKeyFailoverProxy({
      upstreamBaseURL: `https://open.bigmodel.cn${upstreamRoot}`,
      keys: ["only-one"]
    })).rejects.toThrow("at least two API keys");
  });
});
