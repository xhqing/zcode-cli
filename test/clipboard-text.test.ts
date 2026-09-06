import { describe, expect, test } from "bun:test";

import { defaultReadClipboardText } from "../packages/zcode-tui/src/clipboard-text.ts";

describe("clipboard text reading contract", () => {
  test("never throws and resolves to a string or undefined", async () => {
    const text = await defaultReadClipboardText();
    expect(["string", "undefined"]).toContain(typeof text);
  });

  // darwin always ships pbpaste, so the read resolves (an empty clipboard is
  // the valid "" result). Linux CI runners have neither wl-paste nor xclip,
  // which exercises the undefined path instead.
  test.skipIf(process.platform !== "darwin")("darwin resolves through pbpaste", async () => {
    const text = await defaultReadClipboardText();
    expect(typeof text).toBe("string");
  });
});
