import { homedir } from "node:os";

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { createTheme } from "../packages/zcode-tui/src/theme.ts";
import {
  BRAND_MARK,
  BRAND_MARK_WIDTH,
  Divider,
  WelcomeBanner,
  WIDE_BANNER_MIN_WIDTH
} from "../packages/zcode-tui/src/welcome-banner.ts";

function banner(width: number, color = false): string[] {
  return new WelcomeBanner(createTheme(color), {
    branch: "main",
    distributionVersion: "3.3.5-2",
    runtimeVersion: "0.15.2",
    workspace: "/home/alice/work/zcode-cli"
  }).render(width);
}

function identityBanner(identity: { kind: "oauth" | "apiKey"; label: string }, width: number): string[] {
  return new WelcomeBanner(createTheme(false), {
    branch: "main",
    distributionVersion: "3.3.5-2",
    identity,
    runtimeVersion: "0.15.2",
    workspace: "/tmp/project"
  }).render(width);
}

describe("welcome banner", () => {
  test("uses a four-line block-art Z mark", () => {
    expect(BRAND_MARK).toHaveLength(4);
    for (const line of BRAND_MARK) {
      expect(visibleWidth(line)).toBe(BRAND_MARK_WIDTH);
      expect(line).toMatch(/^[\u0020\u2580-\u259f]+$/u);
    }
    expect(BRAND_MARK.some((line) => line !== BRAND_MARK[0])).toBe(true);
  });

  test("paints the Z mark in the accent color", () => {
    const view = new WelcomeBanner(createTheme(true), {
      runtimeVersion: "0.15.2",
      workspace: "/tmp/project"
    });
    const output = view.render(80).join("\n");
    expect(output).toContain("\x1b[38;5;75m"); // cyan Z cells
  });

  test("collapses the home directory prefix to ~", () => {
    const render = (workspace: string): string => {
      const view = new WelcomeBanner(createTheme(false), {
        branch: "main",
        runtimeVersion: "0.15.2",
        workspace
      });
      return view.render(80).join("\n");
    };
    const home = homedir();
    expect(render(`${home}/Documents/Projects/zcode-cli`)).toContain(
      "~/Documents/Projects/zcode-cli · branch main"
    );
    expect(render(home)).toContain("~ · branch main");
    // Paths outside home keep their absolute form.
    expect(render("/home/alice/work/zcode-cli")).not.toContain("~");
  });

  test("integrates identity, versions and workspace into the wide header", () => {
    for (const width of [48, 80, 120]) {
      const lines = banner(width);
      const output = lines.join("\n");
      const plain = output.replace(/\x1b\[[0-9;]*m/gu, "");

      expect(lines).toHaveLength(5);
      expect(plain).toContain("SYSTEM INITIATED");
      expect(plain).toContain("ZCODE  v3.3.5-2");
      expect(plain).toMatch(/(?:runtime|rt) v0\.15\.2/u);
      expect(plain).toMatch(/branch \S+/u);
      expect(plain).toContain("/quit │ Ctrl+D to exit");
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  test("keeps the workspace path intact by truncating from the end", () => {
    const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/gu, "");
    // At 80 columns the full path plus branch fits without any truncation.
    const wide = plain(banner(80).join("\n"));
    expect(wide).toContain("/home/alice/work/zcode-cli · branch main");
    // At 48 columns nothing fits whole; the leading "/" must survive.
    const narrow = plain(banner(48).join("\n"));
    expect(narrow).toMatch(/│ \/home\/alice\/work\/zco…/u);
    expect(narrow).not.toMatch(/…code-cli/u);
  });

  test("does not change layouts for fixture-looking workspace paths", () => {
    for (const workspace of ["/Users/alice/Documents/code/ai/zcode-cli", "/tmp/project"]) {
      const output = new WelcomeBanner(createTheme(false), {
        branch: "main",
        distributionVersion: "3.3.5-2",
        runtimeVersion: "0.15.2",
        workspace
      }).render(80).join("\n");

      expect(output).toContain("SYSTEM INITIATED");
      expect(output).toContain("runtime v0.15.2");
      expect(output).toContain("branch main");
    }
  });

  test("switches to a compact identity with exit hint below the wide breakpoint", () => {
    const lines = banner(WIDE_BANNER_MIN_WIDTH - 1);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("ZCODE  v3.3.5-2");
    expect(lines[1]).toContain("zcode-cli · branch main");
    expect(lines[2]).toContain("/quit");
  });

  test("never wraps at tiny or wide terminal widths", () => {
    for (const width of [1, 8, 20, 47, 48, 80, 120]) {
      const lines = banner(width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  describe("sign-in identity line", () => {
    const plain = (lines: string[]): string => lines.join("\n").replace(/\x1b\[[0-9;]*m/gu, "");

    test("renders the OAuth account in the wide header", () => {
      const lines = identityBanner({ kind: "oauth", label: "Alice" }, 80);
      expect(lines).toHaveLength(6);
      expect(plain(lines)).toContain("Signed in as Alice");
      expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
    });

    test("renders the API key form for explicit key access", () => {
      const output = plain(identityBanner({ kind: "apiKey", label: "916c…e2f1" }, 80));
      expect(output).toContain("API key 916c…e2f1");
    });

    test("renders the identity in the compact layout too", () => {
      const lines = identityBanner({ kind: "oauth", label: "Alice" }, WIDE_BANNER_MIN_WIDTH - 1);
      expect(lines).toHaveLength(4);
      expect(plain(lines)).toContain("Signed in as Alice");
    });

    test("truncates long labels without wrapping", () => {
      const label = "a".repeat(60);
      for (const width of [20, 48, 80]) {
        const lines = identityBanner({ kind: "oauth", label }, width);
        const output = plain(lines);
        expect(output).toContain("Signed in as");
        expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      }
    });

    test("updates after a /login round-trip via setIdentity", () => {
      const view = new WelcomeBanner(createTheme(false), {
        runtimeVersion: "0.15.2",
        workspace: "/tmp/project"
      });
      expect(plain(view.render(80))).not.toContain("Signed in as");
      view.setIdentity({ kind: "oauth", label: "Alice" });
      expect(plain(view.render(80))).toContain("Signed in as Alice");
    });

    test("strips untrusted terminal controls from account names", () => {
      const output = plain(
        identityBanner({ kind: "oauth", label: "Alice\u001b[2J" }, 80)
      );
      expect(output).not.toContain("\x1b[2J");
      expect(output).toContain("Signed in as Alice");
    });
  });

  test("uses theme tokens and strips untrusted terminal controls", () => {
    const view = new WelcomeBanner(createTheme(true, "light"), {
      branch: "main\nsecondary\u001b[2J",
      distributionVersion: "3.3.5-2\u001b]0;bad\u0007",
      runtimeVersion: "0.15.2",
      workspace: "/tmp/project\u001b[H"
    });
    const output = view.render(80).join("\n");

    expect(output).toContain("\x1b[38;5;25m");
    expect(output).not.toContain("\x1b[2J");
    expect(output).not.toContain("\x1b]0;bad");
    expect(output).not.toContain("\x1b[H");
    expect(output).toContain("branch main secondary");
  });
});

describe("Divider component", () => {
  test("renders a single padded line spanning the terminal width", () => {
    const muted = (text: string): string => `\x1b[2m${text}\x1b[0m`;
    const divider = new Divider("─", muted);
    const lines = divider.render(40);
    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0] ?? "")).toBe(40);
    expect(lines[0]).toContain("───◆");
  });

  test("renders an empty line for non-positive widths", () => {
    const divider = new Divider("─", (text) => text);
    expect(divider.render(0)).toEqual([""]);
  });
});
