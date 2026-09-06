import { describe, expect, test } from "bun:test";

import type { RestoredPart } from "../packages/zcode-tui/src/events.ts";
import { createTheme } from "../packages/zcode-tui/src/theme.ts";
import { isVisibleProtocolPart, ProtocolPartView } from "../packages/zcode-tui/src/protocol-part-view.ts";

function view(part: RestoredPart): ProtocolPartView {
  return new ProtocolPartView(createTheme(false), part);
}

describe("visible protocol part filter", () => {
  test("file, retry, compaction, subagent and agent parts are visible", () => {
    expect(isVisibleProtocolPart({ type: "file", text: "f" })).toBe(true);
    expect(isVisibleProtocolPart({ type: "retry", text: "r" })).toBe(true);
    expect(isVisibleProtocolPart({ type: "compaction", text: "c" })).toBe(true);
    expect(isVisibleProtocolPart({ type: "subagent", text: "s" })).toBe(true);
    expect(isVisibleProtocolPart({ type: "agent", text: "a" })).toBe(true);
  });

  test("text, thought and tool parts stay hidden", () => {
    expect(isVisibleProtocolPart({ type: "text", text: "hello" })).toBe(false);
    expect(isVisibleProtocolPart({ type: "thought", text: "thinking" })).toBe(false);
    expect(isVisibleProtocolPart({ type: "tool", toolName: "Read", status: "complete" })).toBe(false);
  });
});

describe("file attachment part", () => {
  const file: RestoredPart = {
    type: "file",
    text: "screenshot data",
    filename: "shot.png",
    mime: "image/png",
    url: "https://example.test/shot.png"
  };

  test("renders the filename and mime, keeping the url behind expansion", () => {
    const rendered = view(file).render(80).join("\n");
    expect(rendered).toContain("Attachment");
    expect(rendered).toContain("shot.png");
    expect(rendered).toContain("image/png");
    expect(rendered).not.toContain("https://example.test/shot.png");
  });

  test("expansion reveals the url and hidden content tracks it", () => {
    const part = view(file);
    expect(part.hasHiddenContent()).toBe(true);
    part.setExpanded(true);
    expect(part.render(80).join("\n")).toContain("https://example.test/shot.png");
    expect(part.hasHiddenContent()).toBe(true);

    const urlLess = view({ type: "file", text: "f", mime: "image/png" });
    expect(urlLess.hasHiddenContent()).toBe(false);
  });

  test("search text covers the text, url and mime", () => {
    expect(view(file).getSearchText()).toContain("screenshot data");
    expect(view(file).getSearchText()).toContain("https://example.test/shot.png");
    expect(view(file).getSearchText()).toContain("image/png");
  });

  test("falls back to the url, then a generic label, when no filename", () => {
    expect(view({ type: "file", text: "f", url: "https://example.test/x.bin" }).render(80).join("\n"))
      .toContain("https://example.test/x.bin");
    expect(view({ type: "file", text: "f" }).render(80).join("\n")).toContain("attachment");
  });
});

describe("retry and compaction parts", () => {
  test("retry shows its text beside the headline", () => {
    const withText = view({ type: "retry", text: "rate limited" }).render(80).join("\n");
    expect(withText).toContain("Retrying model request");
    expect(withText).toContain("rate limited");

    const bare = view({ type: "retry", text: "" }).render(80);
    expect(bare).toHaveLength(1);
    expect(bare[0]).toContain("Retrying model request");
  });

  test("compaction appends the reason when present", () => {
    expect(view({ type: "compaction", text: "c", reason: "context window" }).render(80).join("\n"))
      .toContain("context window");
    expect(view({ type: "compaction", text: "c" }).render(80).join("\n"))
      .not.toContain("·");
  });
});

describe("subagent part", () => {
  const subagent: RestoredPart = {
    type: "subagent",
    text: "scan the code",
    agent: "Explore",
    prompt: "find all tests",
    model: "glm-5.3",
    command: "grep -r test"
  };

  test("renders agent, description and details, prompt behind expansion", () => {
    const rendered = view(subagent).render(80).join("\n");
    expect(rendered).toContain("Explore");
    expect(rendered).toContain("scan the code");
    expect(rendered).toContain("glm-5.3");
    expect(rendered).not.toContain("find all tests");

    const part = view(subagent);
    part.setExpanded(true);
    expect(part.render(80).join("\n")).toContain("find all tests");
  });

  test("falls back to the generic agent label and part text", () => {
    const rendered = view({ type: "subagent", text: "background work" }).render(80).join("\n");
    expect(rendered).toContain("Agent");
    expect(rendered).toContain("background work");
  });

  test("hidden content and search text include prompt, command and model", () => {
    expect(view(subagent).hasHiddenContent()).toBe(true);
    expect(view({ type: "subagent", text: "s" }).hasHiddenContent()).toBe(false);

    const search = view(subagent).getSearchText();
    expect(search).toContain("scan the code");
    expect(search).toContain("find all tests");
    expect(search).toContain("grep -r test");
    expect(search).toContain("glm-5.3");
  });
});

describe("agent part and view updates", () => {
  test("agent renders its name, falling back to the text", () => {
    expect(view({ type: "agent", text: "fallback", name: "Hopper" }).render(80).join("\n"))
      .toContain("Hopper");
    expect(view({ type: "agent", text: "solo" }).render(80).join("\n")).toContain("solo");
  });

  test("update() swaps the rendered part", () => {
    const part = view({ type: "file", text: "f", url: "https://example.test/a.png" });
    expect(part.hasHiddenContent()).toBe(true);
    part.update({ type: "file", text: "f" });
    expect(part.hasHiddenContent()).toBe(false);
    expect(part.render(80).join("\n")).not.toContain("https://example.test/a.png");
  });

  test("expansion state survives part updates", () => {
    const part = view(subagentPart());
    part.setExpanded(true);
    part.update({ type: "retry", text: "r" });
    expect(part.isExpanded()).toBe(true);
  });
});

function subagentPart(): RestoredPart {
  return { type: "subagent", text: "s", prompt: "p" };
}
