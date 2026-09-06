import { describe, expect, test } from "bun:test";
import type { Component } from "@earendil-works/pi-tui";

import {
  isExpandableComponent,
  isSearchableComponent,
  isWindowedComponent
} from "../packages/zcode-tui/src/renderable.ts";

function component(extra: Record<string, unknown>): Component {
  return {
    render: (_width: number) => [],
    invalidate: () => {},
    ...extra
  } as Component;
}

describe("expandable component guard", () => {
  test("accepts an object with the full expandable trio", () => {
    const expandable = component({
      setExpanded: (_expanded: boolean) => {},
      isExpanded: () => false,
      hasHiddenContent: () => false
    });
    expect(isExpandableComponent(expandable)).toBe(true);
  });

  test("rejects objects missing any of the three methods", () => {
    expect(isExpandableComponent(component({
      isExpanded: () => false,
      hasHiddenContent: () => false
    }))).toBe(false);
    expect(isExpandableComponent(component({
      setExpanded: (_expanded: boolean) => {},
      hasHiddenContent: () => false
    }))).toBe(false);
    expect(isExpandableComponent(component({
      setExpanded: (_expanded: boolean) => {},
      isExpanded: () => false
    }))).toBe(false);
    expect(isExpandableComponent(component({}))).toBe(false);
  });
});

describe("searchable component guard", () => {
  test("accepts an object with getSearchText only", () => {
    expect(isSearchableComponent(component({ getSearchText: () => "" }))).toBe(true);
  });

  test("rejects plain components", () => {
    expect(isSearchableComponent(component({}))).toBe(false);
  });
});

describe("windowed component guard", () => {
  test("accepts an object with renderWindow", () => {
    const windowed = component({ renderWindow: (_w: number, _s: number, _c: number) => ({ lines: [], totalLines: 0 }) });
    expect(isWindowedComponent(windowed)).toBe(true);
  });

  test("rejects plain components", () => {
    expect(isWindowedComponent(component({}))).toBe(false);
  });
});
