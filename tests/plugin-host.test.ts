import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PluginHost } from "../src/main/plugin-host.js";

describe("PluginHost", () => {
  const host = new PluginHost();
  const pluginPath = resolve("examples/echo-plugin");

  afterEach(async () => {
    await host.disconnect("example-echo");
  });

  it("loads a manifest, discovers tools, and calls an isolated plugin", async () => {
    const loaded = await host.loadManifest(pluginPath);
    const profile = { id: loaded.manifest.id, name: loaded.manifest.name, version: loaded.manifest.version, path: loaded.path, permissions: loaded.manifest.permissions, enabled: true };
    const tools = await host.listTools({ ...profile, createdAt: "", updatedAt: "" }, () => "ask");
    expect(tools).toMatchObject([{ name: "echo", authorization: "ask" }]);
    await expect(host.callTool({ ...profile, createdAt: "", updatedAt: "" }, "echo", { text: "hello" })).resolves.toBe("hello");
  });
});
