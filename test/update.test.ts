import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  downloadReleaseTarball,
  isUpdateInvocation,
  packageName,
  releaseAssetName,
  runSelfUpdate,
  updateRepository
} from "../src/update.ts";

function output(): { stream: Writable; text: () => string } {
  let value = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      value += String(chunk);
      callback();
    }
  });
  return { stream, text: () => value };
}

function harness() {
  const stdout = output();
  const stderr = output();
  return { stderr, stdout };
}

describe("self-update invocation", () => {
  test("accepts both the subcommand and flag spellings", () => {
    expect(isUpdateInvocation(["update"])).toBe(true);
    expect(isUpdateInvocation(["--update"])).toBe(true);
    expect(isUpdateInvocation(["update", "--json"])).toBe(false);
    expect(isUpdateInvocation(["--update", "--force"])).toBe(false);
    expect(isUpdateInvocation([])).toBe(false);
    expect(isUpdateInvocation(["login"])).toBe(false);
  });
});

describe("self-update tarball download", () => {
  test("downloads the matching tarball asset from GitHub Releases", async () => {
    const requested: string[][] = [];
    const tarball = await downloadReleaseTarball(
      { tagName: "v3.3.5-2", version: "3.3.5-2" },
      "/tmp/zcode-download",
      {
        ghDownload: async (args) => {
          requested.push(args);
          return { code: 0, stderr: "" };
        }
      }
    );
    expect(tarball).toBe(join("/tmp/zcode-download", releaseAssetName("3.3.5-2")));
    expect(requested).toHaveLength(1);
    expect(requested[0]!.join(" ")).toContain(`--pattern ${releaseAssetName("3.3.5-2")}`);
    expect(requested[0]!.join(" ")).toContain(`--repo ${updateRepository}`);
  });

  test("treats a release without the tarball asset as an error, without npm fallback", async () => {
    await expect(downloadReleaseTarball(
      { tagName: "v3.3.5-2", version: "3.3.5-2" },
      "/tmp/zcode-download",
      { ghDownload: async () => ({ code: 1, stderr: "no assets match the pattern" }) }
    )).rejects.toThrow("no assets match the pattern");
  });

  test("keeps the repository constant aligned with the project remote", () => {
    expect(updateRepository).toBe("xhqing/zcode-cli");
    expect(packageName).toBe("zcode-cli");
  });

  test("names release assets after the project", () => {
    expect(releaseAssetName("3.3.5-2")).toBe("zcode-cli-3.3.5-2.tgz");
  });
});

describe("self-update run", () => {
  test("reports and installs a newer release from GitHub", async () => {
    const streams = harness();
    const installed: string[] = [];
    const temporary: string[] = [];
    const code = await runSelfUpdate("3.3.5-1", {
      downloadRunners: {
        ghDownload: async () => ({ code: 0, stderr: "" })
      },
      fetchLatest: async () => ({ tagName: "v3.3.5-2", version: "3.3.5-2" }),
      install: async (tarballPath) => {
        installed.push(tarballPath);
      },
      makeTempDir: async () => {
        const directory = `/tmp/zcode-update-fake-${temporary.length}`;
        temporary.push(directory);
        return directory;
      },
      stderr: streams.stderr.stream,
      stdout: streams.stdout.stream
    });

    expect(code).toBe(0);
    expect(installed).toEqual([join(temporary[0]!, releaseAssetName("3.3.5-2"))]);
    expect(streams.stdout.text()).toContain("Checking for zcode-cli updates…");
    expect(streams.stdout.text()).toContain("Current version : 3.3.5-1");
    expect(streams.stdout.text()).toContain("Latest version  : 3.3.5-2 (xhqing/zcode-cli release)");
    expect(streams.stdout.text()).toContain("Updated to 3.3.5-2 successfully!");
  });

  test("skips installation when the current build is already newest", async () => {
    const streams = harness();
    const installed: string[] = [];
    const code = await runSelfUpdate("3.3.5-2", {
      fetchLatest: async () => ({ tagName: "v3.3.5-2", version: "3.3.5-2" }),
      install: async (tarballPath) => {
        installed.push(tarballPath);
      },
      stderr: streams.stderr.stream,
      stdout: streams.stdout.stream
    });

    expect(code).toBe(0);
    expect(installed).toEqual([]);
    expect(streams.stdout.text()).toContain("Already up-to-date.");
  });

  test("explains that GitHub Releases are the only channel when none exist", async () => {
    const streams = harness();
    await expect(runSelfUpdate("3.3.5-1", {
      fetchLatest: async () => {
        throw new Error("release not found");
      },
      stderr: streams.stderr.stream,
      stdout: streams.stdout.stream
    })).rejects.toThrow("No GitHub Release exists yet in xhqing/zcode-cli");
  });

  test("keeps download failures actionable with a manual-install hint", async () => {
    const streams = harness();
    await expect(runSelfUpdate("3.3.5-1", {
      fetchLatest: async () => ({ tagName: "v3.3.5-2", version: "3.3.5-2" }),
      downloadRunners: {
        ghDownload: async () => ({ code: 1, stderr: "gh: network unreachable" })
      },
      makeTempDir: async () => "/tmp/zcode-update-fake-dl",
      stderr: streams.stderr.stream,
      stdout: streams.stdout.stream
    })).rejects.toThrow("network unreachable");
  });
});

describe("launcher --update dispatch", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const node = process.execPath;
  let home = "";

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "zcode-update-launcher-"));
  });

  afterAll(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function runLauncher(
    args: string[],
    environment: Record<string, string> = {}
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const child = Bun.spawn([node, "bin/zcode.js", ...args], {
      cwd: root,
      env: { ...process.env, HOME: home, USERPROFILE: home, ...environment },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe"
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ]);
    return { code, stdout, stderr };
  }

  test("routes the update spellings before any runtime spawn", async () => {
    // The packaged bin dispatches --update through main(); a fake `gh` on
    // PATH reports a newer release, proving the launcher reached the update
    // handler instead of spawning the interactive runtime.
    const directory = await mkdtemp(join(tmpdir(), "zcode-update-fakebin-"));
    try {
      const fakeGh = join(directory, "gh");
      await writeFile(fakeGh, [
        "#!/bin/sh",
        // Latest release exists at a higher build than the checked-out one.
        "echo '{\"tagName\":\"v99.0.0-1\"}'",
        "exit 0",
        ""
      ].join("\n"));
      await chmod(fakeGh, 0o755);
      const result = await runLauncher(["--update"], { PATH: `${directory}:${process.env.PATH}` });
      expect(result.stdout).toContain("Checking for zcode-cli updates…");
      expect(result.stdout).toContain("Current version : 3.8.1-24");
      expect(result.stdout).toContain("Latest version  : 99.0.0-1 (xhqing/zcode-cli release)");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
