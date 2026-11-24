import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { WorkspaceTools } from "../src/tools.js";

describe("WorkspaceTools", () => {
  let workspace: string;
  let tools: WorkspaceTools;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "xpaw-tools-"));
    tools = new WorkspaceTools(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("rejects paths outside the workspace", () => {
    expect(() => tools.resolvePath("../secret.txt")).toThrow("outside the authorized workspace");
    expect(() => tools.resolvePath("C:\\Windows\\system.ini")).toThrow("outside the authorized workspace");
  });

  it("writes then reads a file inside the workspace", async () => {
    await tools.writeFile({ path: "notes/hello.md", content: "# Hello\nXPaw" });
    const result = await tools.readFile({ path: "notes/hello.md" });
    expect(result.content).toBe("# Hello\nXPaw");
  });

  it("searches readable files inside the workspace", async () => {
    await tools.writeFile({ path: "notes/a.txt", content: "Important project decision" });
    const result = await tools.searchFiles({ query: "project" });
    expect(result.content).toContain(`notes${sep}a.txt:1`);
  });
});
