import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import { abbreviateWorkspaceDirectory } from "./welcome-banner.ts";

export const TURN_TIMER_FRAME_DURATION_MS = 1_000;

/**
 * Longest workspace label shown beside the turn timer. The welcome banner
 * scrolls away in long sessions, so the footer carries the directory too;
 * the budget keeps room for the right-aligned goal status on an 80-column
 * terminal, and beyond it the path is truncated from the start because
 * parallel sessions differ mostly by their final path segment.
 */
export const TURN_STATUS_DIRECTORY_MAX_COLUMNS = 24;

// Unicode clock faces form a complete, same-style rotation with stable terminal width.
const turnTimerFrames = ["🕛", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚"] as const;
const settledTurnTimerFrame = "🕛";
const completedTurnTimerFrame = "✓";
const reducedMotionValues = new Set(["1", "true", "yes", "on"]);

export function turnTimerAnimationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const reducedMotion = env.ZCODE_TUI_REDUCED_MOTION?.trim().toLowerCase() ?? "";
  return env.TERM?.trim().toLowerCase() !== "dumb" && !reducedMotionValues.has(reducedMotion);
}

export function turnTimerFrame(elapsedMilliseconds: number, animated = false): string {
  if (!animated) return settledTurnTimerFrame;
  const frame = Math.floor(Math.max(0, elapsedMilliseconds) / TURN_TIMER_FRAME_DURATION_MS);
  return turnTimerFrames[frame % turnTimerFrames.length] ?? turnTimerFrames[0];
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const seconds = totalSeconds % 60;
  if (totalSeconds < 3_600) {
    return `${Math.floor(totalSeconds / 60)}m ${seconds.toString().padStart(2, "0")}s`;
  }

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
}

export function turnStatusText(
  activity: string | undefined,
  elapsedMilliseconds: number,
  showElapsed = true,
  animateTimer = false,
  completed = false
): string | undefined {
  if (!showElapsed) return activity;
  const frame = completed ? completedTurnTimerFrame : turnTimerFrame(elapsedMilliseconds, animateTimer);
  const elapsed = `[ ${frame} ${formatElapsed(elapsedMilliseconds)} ]`;
  return activity ? `${activity} ── ${elapsed}` : elapsed;
}

/**
 * Workspace label for the turn-status footer: "~"-abbreviated, and truncated
 * from the start once it exceeds the column budget so the project name at
 * the end of the path stays visible.
 */
export function turnStatusDirectoryText(
  workspace: string | undefined,
  maxColumns = TURN_STATUS_DIRECTORY_MAX_COLUMNS
): string | undefined {
  if (!workspace) return undefined;
  const directory = abbreviateWorkspaceDirectory(workspace);
  const width = visibleWidth(directory);
  if (width <= maxColumns) return directory;
  const keepWidth = Math.max(1, maxColumns - 1);
  return `…${sliceByColumn(directory, width - keepWidth, keepWidth)}`;
}
