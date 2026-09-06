import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { pluginProtocolMethods, pluginWorkspace } from "../src/plugin-protocol.ts";

describe("plugin protocol method names", () => {
  test("locks the app-server plugin method routing table", () => {
    expect(pluginProtocolMethods).toEqual({
      configure: "plugins/configure",
      describe: "plugins/describe",
      install: "plugins/install",
      marketplaceAdd: "plugins/marketplace/add",
      marketplaceRemove: "plugins/marketplace/remove",
      marketplaceUpdate: "plugins/marketplace/update",
      overview: "plugins/overview",
      referenceCatalog: "plugins/referenceCatalog",
      restoreBuiltin: "plugins/restoreBuiltin",
      update: "plugins/update",
      validate: "plugins/validate"
    });
  });
});

describe("plugin workspace resolution", () => {
  test("resolves relative input to an absolute path used as the key", () => {
    const workspace = pluginWorkspace(".");
    expect(workspace.workspacePath).toBe(resolve("."));
    expect(workspace.workspaceKey).toBe(workspace.workspacePath);
  });

  test("normalizes trailing separators and inner segments", () => {
    expect(pluginWorkspace("a/b/").workspacePath).toBe(resolve("a/b"));
    expect(pluginWorkspace("a/./b").workspacePath).toBe(resolve("a/b"));
    expect(pluginWorkspace("a/b/").workspaceKey).toBe(pluginWorkspace("a/b").workspaceKey);
  });

  test("keeps absolute input unchanged apart from normalization", () => {
    const workspace = pluginWorkspace("/tmp/some workspace");
    expect(workspace.workspacePath).toBe("/tmp/some workspace");
    expect(workspace.workspaceKey).toBe("/tmp/some workspace");
  });
});
