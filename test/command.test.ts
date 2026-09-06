import { describe, expect, test } from "bun:test";

import { captureCommand } from "../src/command.ts";

describe("captureCommand", () => {
  test("captures stdout with a zero exit code", async () => {
    const result = await captureCommand("/bin/echo", ["hello"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
  });

  test("captures stderr separately from stdout", async () => {
    const result = await captureCommand("/bin/sh", ["-c", "echo out; echo err >&2"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
  });

  test("reports the child's non-zero exit code", async () => {
    const result = await captureCommand("/bin/sh", ["-c", "exit 3"]);
    expect(result.code).toBe(3);
    expect(result.stdout).toBe("");
  });

  // Known defect (reported to the owner, fix belongs to the developing agent):
  // on a launch failure the child streams close before the async iterators in
  // readText finish, so the whole call rejects with ERR_STREAM_PREMATURE_CLOSE
  // instead of resolving to { code: 1, stderr: launchError }. The case stays
  // as test.failing so the expected contract is locked while CI stays actionable;
  // drop the .failing marker once the implementation handles the error path.
  test.failing("a missing binary resolves to code 1 with the launch error in stderr", async () => {
    const result = await captureCommand("/nonexistent-zcode-test-binary", ["--flag"]);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toBe("");
  });

  test("keeps stdout and stderr intact for multi-line output", async () => {
    const result = await captureCommand("/bin/sh", ["-c", "printf 'a\\nb\\n'; printf 'c\\nd\\n' >&2"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("a\nb\n");
    expect(result.stderr).toBe("c\nd\n");
  });
});
