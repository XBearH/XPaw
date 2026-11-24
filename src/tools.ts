import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ToolDefinition, ToolResult } from "./types.js";

const pathSchema = z.object({ path: z.string().min(1) });
const writeFileSchema = pathSchema.extend({ content: z.string() });
const searchSchema = z.object({ query: z.string().min(1).max(200), path: z.string().optional().default(".") });

export const toolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories inside the authorized local workspace. Paths are relative to that workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative directory path, default '.'" } },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file inside the authorized local workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative file path" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search UTF-8 text files in the authorized workspace for a literal text query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Literal text to search for" },
          path: { type: "string", description: "Optional relative directory, default '.'" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 text file in the authorized workspace. The user must explicitly approve this action.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Complete replacement content" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
];

export class WorkspaceTools {
  constructor(private readonly workspacePath: string) {}

  resolvePath(userPath: string): string {
    const target = resolve(this.workspacePath, userPath);
    const workspace = resolve(this.workspacePath);
    if (target === workspace || target.startsWith(`${workspace}${sep}`)) {
      return target;
    }
    throw new Error("The requested path is outside the authorized workspace.");
  }

  async listFiles(raw: unknown): Promise<ToolResult> {
    const { path = "." } = z.object({ path: z.string().optional().default(".") }).parse(raw);
    const directory = this.resolvePath(path);
    const entries = await readdir(directory, { withFileTypes: true });
    const lines = entries.slice(0, 200).map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`);
    return { content: lines.join("\n") || "(empty directory)", summary: `Listed ${entries.length} entries in ${path}.` };
  }

  async readFile(raw: unknown): Promise<ToolResult> {
    const { path } = pathSchema.parse(raw);
    const filePath = this.resolvePath(path);
    const content = await readFile(filePath, "utf8");
    const truncated = content.length > 20_000 ? `${content.slice(0, 20_000)}\n\n[truncated]` : content;
    return { content: truncated, summary: `Read ${path}.` };
  }

  async searchFiles(raw: unknown): Promise<ToolResult> {
    const { query, path } = searchSchema.parse(raw);
    const root = this.resolvePath(path);
    const results: string[] = [];
    await this.searchDirectory(root, query, results);
    return {
      content: results.join("\n") || "No matches found.",
      summary: `Found ${results.length} matching lines for ${JSON.stringify(query)}.`,
    };
  }

  async writeFile(raw: unknown): Promise<ToolResult> {
    const { path, content } = writeFileSchema.parse(raw);
    const filePath = this.resolvePath(path);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    await writeFile(filePath, content, "utf8");
    return { content: `Wrote ${path}.`, summary: `Wrote ${content.length} characters to ${path}.` };
  }

  async fileExists(raw: unknown): Promise<boolean> {
    const { path } = pathSchema.parse(raw);
    try {
      await access(this.resolvePath(path), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async searchDirectory(directory: string, query: string, results: string[]): Promise<void> {
    if (results.length >= 100) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= 100) return;
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (![".git", "node_modules"].includes(entry.name)) await this.searchDirectory(fullPath, query, results);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const text = await readFile(fullPath, "utf8");
        text.split(/\r?\n/).forEach((line, index) => {
          if (results.length < 100 && line.includes(query)) {
            results.push(`${relative(this.workspacePath, fullPath)}:${index + 1}: ${line.slice(0, 500)}`);
          }
        });
      } catch {
        // Binary or unreadable files are intentionally skipped.
      }
    }
  }
}
