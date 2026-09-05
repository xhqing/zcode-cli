import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  TURN_TIMER_FRAME_DURATION_MS,
  formatElapsed,
  turnStatusDirectoryText,
  turnStatusText,
  turnTimerAnimationEnabled,
  turnTimerFrame
} from "../packages/zcode-tui/src/turn-status.ts";

describe("TUI turn status", () => {
  test("formats elapsed time compactly", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59_999)).toBe("59s");
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(185_000)).toBe("3m 05s");
    expect(formatElapsed(3_661_000)).toBe("1h 01m 01s");
  });

  test("keeps elapsed time visible with or without turn activity", () => {
    expect(turnStatusText(undefined, 0)).toBe("[ 🕛 0s ]");
    expect(turnStatusText("thinking…", 3_000)).toBe("thinking… ── [ 🕛 3s ]");
  });

  test("marks a settled foreground turn as completed instead of frozen", () => {
    expect(turnStatusText(undefined, 364_000, true, false, true)).toBe("[ ✓ 6m 04s ]");
  });

  test("animates the active timer with complete stable-width clock frames", () => {
    const frames = Array.from(
      { length: 12 },
      (_, index) => turnTimerFrame(index * TURN_TIMER_FRAME_DURATION_MS, true)
    );
    expect(TURN_TIMER_FRAME_DURATION_MS).toBe(1_000);
    expect(frames).toEqual(["🕛", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚"]);
    expect(frames.map(visibleWidth)).toEqual(Array(12).fill(2));
    expect(turnTimerFrame(12_000, true)).toBe("🕛");
    expect(turnStatusText("thinking…", 4_000, true, true)).toBe("thinking… ── [ 🕓 4s ]");
  });

  test("provides an explicit reduced-motion and basic-terminal fallback", () => {
    expect(turnTimerAnimationEnabled({ TERM: "xterm-256color" })).toBeTrue();
    expect(turnTimerAnimationEnabled({ TERM: "dumb" })).toBeFalse();
    expect(turnTimerAnimationEnabled({ ZCODE_TUI_REDUCED_MOTION: "1" })).toBeFalse();
    expect(turnTimerFrame(500, false)).toBe("🕛");
  });

  test("hides idle timing without suppressing out-of-turn activity", () => {
    expect(turnStatusText(undefined, 0, false)).toBeUndefined();
    expect(turnStatusText("Esc again to rewind conversation", 0, false)).toBe("Esc again to rewind conversation");
  });

  test("abbreviates the workspace directory the way the banner does", () => {
    expect(turnStatusDirectoryText(`${homedir()}/Developer/zcode-cli`)).toBe(
      `~${"/Developer/zcode-cli"}`
    );
    expect(turnStatusDirectoryText(homedir())).toBe("~");
    expect(turnStatusDirectoryText("/opt/work/project")).toBe("/opt/work/project");
    expect(turnStatusDirectoryText(undefined)).toBeUndefined();
  });

  test("truncates an oversized directory from the start so the project name stays visible", () => {
    const label = turnStatusDirectoryText("/opt/very-long-path/to-the-project", 16);
    expect(label).toBe("…/to-the-project");
    expect(visibleWidth(label ?? "")).toBeLessThanOrEqual(16);
    expect(turnStatusDirectoryText("/opt/short", 10)).toBe("/opt/short");
  });

  test("keeps wide-character path segments intact while truncating", () => {
    const label = turnStatusDirectoryText("/opt/projects/中文项目目录名称", 10);
    expect(label?.endsWith("目录名称")).toBeTrue();
    expect(visibleWidth(label ?? "")).toBeLessThanOrEqual(10);
  });
});
