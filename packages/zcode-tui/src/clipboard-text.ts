import { spawn } from "node:child_process";

const MAX_TEXT_BYTES = 1024 * 1024;

type ClipboardReader = readonly [command: string, args: readonly string[]];

function platformReaders(platform: NodeJS.Platform): ClipboardReader[] {
  switch (platform) {
    case "darwin":
      return [["pbpaste", []]];
    case "linux":
      // wl-paste may append a trailing newline for single-line content; --no-newline keeps it verbatim.
      return [["wl-paste", ["--no-newline"]], ["xclip", ["-selection", "clipboard", "-o"]]];
    case "win32":
      return [["powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"]]];
    default:
      return [];
  }
}

function readVia(reader: ClipboardReader, signal?: AbortSignal): Promise<string | undefined> {
  const [command, args] = reader;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { signal, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      if (totalBytes >= MAX_TEXT_BYTES) {
        child.kill();
        return;
      }
      totalBytes += chunk.byteLength;
      chunks.push(chunk);
    });
    child.on("error", () => finish(undefined));
    child.on("close", (exitCode) => {
      if (chunks.length > 0) finish(Buffer.concat(chunks).toString("utf8"));
      else finish(exitCode === 0 ? "" : undefined);
    });
  });
}

/**
 * Reads plain text from the system clipboard. Returns "" when the clipboard
 * is readable but holds no text (e.g. only an image), undefined when no
 * clipboard tool is available.
 */
export async function defaultReadClipboardText(
  options: { abortSignal?: AbortSignal } = {}
): Promise<string | undefined> {
  for (const reader of platformReaders(process.platform)) {
    const text = await readVia(reader, options.abortSignal);
    if (text !== undefined) return text;
  }
  return undefined;
}
