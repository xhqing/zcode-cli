import { describe, expect, test } from "bun:test";

import { createTheme } from "../packages/zcode-tui/src/theme.ts";
import { ToolGroupView } from "../packages/zcode-tui/src/tool-group-view.ts";
import { ToolExecutionView } from "../packages/zcode-tui/src/tool-view.ts";

interface Fixture {
  view: ToolGroupView;
  add: (name: string, state?: string) => ToolExecutionView;
}

function fixture(): Fixture {
  const theme = createTheme(false);
  const view = new ToolGroupView(theme);
  return {
    view,
    add: (name, state = "complete") => {
      const tool = new ToolExecutionView(theme, { name, state });
      view.addTool(tool);
      return tool;
    }
  };
}

describe("TUI tool group membership", () => {
  test("tracks size and supports removing members", () => {
    const { view, add } = fixture();
    expect(view.size).toBe(0);
    const read = add("Read");
    add("Grep");
    expect(view.size).toBe(2);

    expect(view.removeTool(read)).toBe(true);
    expect(view.size).toBe(1);
    expect(view.removeTool(read)).toBe(false);
  });

  test("expansion propagates to existing and later-added tools", () => {
    const { view, add } = fixture();
    const early = add("Read");
    view.setExpanded(true);
    expect(view.isExpanded()).toBe(true);
    expect(early.isExpanded()).toBe(true);

    const late = add("Grep");
    expect(late.isExpanded()).toBe(true);

    view.setExpanded(false);
    expect(early.isExpanded()).toBe(false);
    expect(late.isExpanded()).toBe(false);
  });

  test("hidden content only exists while collapsed with members", () => {
    const { view, add } = fixture();
    expect(view.hasHiddenContent()).toBe(false);
    add("Read");
    expect(view.hasHiddenContent()).toBe(true);
    view.setExpanded(true);
    expect(view.hasHiddenContent()).toBe(false);
  });

  test("search text joins every member's search text", () => {
    const { view, add } = fixture();
    add("Read");
    add("Grep");
    expect(view.getSearchText()).toBe("Read\nGrep");
  });
});

describe("TUI tool group collapsed summary", () => {
  test("summarizes completed reads with plural forms", () => {
    const { view, add } = fixture();
    add("Read");
    let line = view.render(80).join("\n");
    expect(line).toContain("Read 1 file");
    expect(line).not.toContain("files");

    add("Read");
    line = view.render(80).join("\n");
    expect(line).toContain("Read 2 files");
    expect(line).toContain("Ctrl+O to expand");
  });

  test("running reads say Reading with an ellipsis", () => {
    const { view, add } = fixture();
    add("Read", "running");
    const line = view.render(80).join("\n");
    expect(line).toContain("Reading 1 file");
    expect(line).toContain("…");
  });

  test("summarizes search tools separately from reads", () => {
    const { view, add } = fixture();
    add("Grep", "running");
    const line = view.render(80).join("\n");
    expect(line).toContain("searching 1 pattern");

    const done = fixture();
    done.add("Grep");
    done.add("Glob");
    done.add("Glob");
    const doneLine = done.view.render(80).join("\n");
    expect(doneLine).toContain("searched 3 patterns");
    expect(doneLine).not.toContain("file");
  });

  test("failure wins the icon over interruption and activity", () => {
    const { view, add } = fixture();
    add("Read", "running");
    add("Grep", "failed");
    let line = view.render(80).join("\n");
    expect(line).toContain("✗");
    expect(line).not.toContain("■");

    const second = fixture();
    second.add("Read", "rejected");
    line = second.view.render(80).join("\n");
    expect(line).toContain("■");
  });

  test("a quiet completed group shows the muted idle icon", () => {
    const { view, add } = fixture();
    add("Read");
    const line = view.render(80).join("\n");
    expect(line).toContain("○");
  });

  test("renders each member with a blank separator when expanded", () => {
    const { view, add } = fixture();
    add("Read");
    add("Grep");
    view.setExpanded(true);
    const lines = view.render(80);
    const rendered = lines.join("\n");
    expect(rendered).toContain("Read");
    expect(rendered).toContain("Grep");
    // Two tool cards separated by exactly one blank line.
    const separators = lines.filter((line) => line === "").length;
    expect(separators).toBe(1);
  });
});
