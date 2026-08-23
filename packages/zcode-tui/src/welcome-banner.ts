import { homedir } from "node:os";

import {
  truncateToWidth,
  visibleWidth,
  type Component
} from "@earendil-works/pi-tui";

import { sanitizeTerminalText } from "./terminal-text.ts";
import type { ZCodeTheme } from "./theme.ts";

/** A terminal interpretation of the split, diagonal Z in the Desktop app icon. */
export const BRAND_MARK: readonly string[] = [
  "█████ ▄███",
  "    ▄██▀  ",
  "  ▄██▀    ",
  "▄███ █████"
];

export const BRAND_MARK_WIDTH = 10;
export const WIDE_BANNER_MIN_WIDTH = 48;

const maxInformationWidth = 72;
const boxTitle = "── SYSTEM INITIATED ";

export interface WelcomeBannerOptions {
  branch?: string;
  distributionVersion?: string;
  runtimeVersion: string;
  workspace: string;
}

function bannerText(value: string): string {
  return sanitizeTerminalText(value, { preserveSgr: false }).replace(/\s+/gu, " ").trim();
}

function padTerminalText(value: string, width: number): string {
  const truncated = truncateToWidth(value, Math.max(0, width), "…");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function boxRule(prefix: "┌" | "└", width: number): string {
  const content = prefix === "┌" ? boxTitle : "";
  return `${prefix}${content}${"─".repeat(Math.max(0, width - 1 - visibleWidth(content)))}`;
}

export class WelcomeBanner implements Component {
  private readonly branch?: string;
  private readonly distributionVersion?: string;
  private readonly runtimeVersion: string;
  private readonly workspace: string;

  constructor(
    private readonly theme: ZCodeTheme,
    options: WelcomeBannerOptions
  ) {
    this.branch = options.branch
      ? bannerText(options.branch)
      : undefined;
    this.distributionVersion = options.distributionVersion
      ? bannerText(options.distributionVersion)
      : undefined;
    this.runtimeVersion = bannerText(options.runtimeVersion);
    this.workspace = bannerText(options.workspace);
  }

  render(width: number): string[] {
    if (width <= 0) return [""];
    return width >= WIDE_BANNER_MIN_WIDTH
      ? this.renderWide(width)
      : this.renderCompact(width);
  }

  invalidate(): void {}

  private renderWide(width: number): string[] {
    const contentWidth = Math.max(1, width - 1);
    const gap = "   ";
    const informationWidth = Math.max(1, contentWidth - BRAND_MARK_WIDTH - gap.length);
    const panelWidth = Math.min(informationWidth, maxInformationWidth);
    const panelContentWidth = Math.max(1, panelWidth - 2);
    const primaryVersion = this.distributionVersion ?? this.runtimeVersion;
    const identity = `${this.theme.bold(this.theme.accent("ZCODE"))}  ${this.theme.muted(`v${primaryVersion}`)}`;
    const fullVersionLine = this.distributionVersion
      ? `${identity}${this.theme.muted(` · runtime v${this.runtimeVersion}`)}`
      : identity;
    const compactVersionLine = this.distributionVersion
      ? `${identity}${this.theme.muted(` · rt v${this.runtimeVersion}`)}`
      : identity;
    const versionLine = visibleWidth(fullVersionLine) <= panelContentWidth
      ? fullVersionLine
      : compactVersionLine;
    const locationLine = this.locationLine(panelContentWidth);
    // The exit hint must stay visible without the autocomplete list: plain
    // "quit"/"exit" reads as chat input, only the /-prefixed forms exit.
    const exitHint = "/quit │ Ctrl+D to exit";
    const information = [
      this.theme.muted(boxRule("┌", panelWidth)),
      `${this.theme.muted("│")} ${padTerminalText(versionLine, panelContentWidth)}`,
      `${this.theme.muted("│")} ${this.theme.muted(padTerminalText(locationLine, panelContentWidth))}`,
      `${this.theme.muted("│")} ${this.theme.muted(padTerminalText(exitHint, panelContentWidth))}`,
      this.theme.muted(boxRule("└", panelWidth))
    ];

    return information.map((line, index) => (
      ` ${this.theme.accent(BRAND_MARK[index] ?? "")}${gap}${line}`
    ));
  }

  /** Collapse the home directory prefix to "~", the way shell prompts do. */
  private displayWorkspace(): string {
    const home = homedir();
    if (!home || home === "/") return this.workspace;
    const prefix = home.endsWith("/") ? home.slice(0, -1) : home;
    if (this.workspace === prefix) return "~";
    for (const separator of ["/", "\\"]) {
      if (this.workspace.startsWith(`${prefix}${separator}`)) {
        return `~${this.workspace.slice(prefix.length)}`;
      }
    }
    return this.workspace;
  }

  private locationLine(width: number): string {
    const workspace = this.displayWorkspace();
    if (!this.branch) return truncateToWidth(workspace, width, "…");
    const separator = " · ";
    // Keep the workspace an intact path whenever it fits: shrink the
    // branch label first, and truncate the path from the end (not the start)
    // only as a last resort so the leading "~" or "/" stays visible.
    const separatorWidth = visibleWidth(separator);
    const fullBranch = `branch ${this.branch}`;
    if (visibleWidth(workspace) + separatorWidth + visibleWidth(fullBranch) <= width) {
      return `${workspace}${separator}${fullBranch}`;
    }
    const workspaceWidth = visibleWidth(workspace);
    const branchBudget = Math.max(0, width - workspaceWidth - separatorWidth);
    if (branchBudget >= visibleWidth("branch…")) {
      const branch = truncateToWidth(fullBranch, branchBudget, "…");
      return `${workspace}${separator}${branch}`;
    }
    const branchWidth = Math.max(8, Math.floor(width * 0.25));
    const branch = truncateToWidth(fullBranch, branchWidth, "…");
    const pathBudget = width - separatorWidth - visibleWidth(branch);
    if (pathBudget < 4) return truncateToWidth(fullBranch, width, "…");
    return `${truncateToWidth(workspace, pathBudget, "…")}${separator}${branch}`;
  }

  private renderCompact(width: number): string[] {
    const contentWidth = Math.max(0, width - 1);
    const primaryVersion = this.distributionVersion ?? this.runtimeVersion;
    const identity = `${this.theme.bold(this.theme.accent("ZCODE"))}  ${this.theme.muted(`v${primaryVersion}`)}`;
    const location = [this.displayWorkspace(), this.branch ? `branch ${this.branch}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" · ");
    return [
      ` ${truncateToWidth(identity, contentWidth)}`,
      ` ${this.theme.muted(truncateToWidth(location, contentWidth, "…"))}`,
      ` ${this.theme.muted(truncateToWidth("/quit │ Ctrl+D to exit", contentWidth))}`
    ];
  }
}

/** A quiet full-width rule separating startup identity from the conversation. */
export class Divider implements Component {
  constructor(
    private readonly char: string,
    private readonly style: (text: string) => string
  ) {}

  render(width: number): string[] {
    if (width <= 0) return [""];
    const baseWidth = Math.max(0, width - 1);
    if (baseWidth < 8) {
      return [` ${this.style(this.char.repeat(baseWidth))}`];
    }
    const prefix = `${this.char.repeat(3)}◆`;
    const suffix = this.char.repeat(Math.max(0, baseWidth - visibleWidth(prefix)));
    return [` ${this.style(truncateToWidth(prefix + suffix, baseWidth))}`];
  }

  invalidate(): void {}
}
