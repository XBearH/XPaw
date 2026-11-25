import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { PluginManifest, PluginProfile, PluginToolInfo, ToolDefinition } from "../types.js";

const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  main: z.string().min(1),
  permissions: z.array(z.string()).default([]),
});

const toolSchema = z.object({ name: z.string().min(1), description: z.string().default(""), inputSchema: z.record(z.string(), z.unknown()).default({}) });

type Connection = { process: ChildProcessWithoutNullStreams; pending: Map<string, { resolve(value: unknown): void; reject(error: Error): void }>; buffer: string };

export class PluginHost {
  private readonly connections = new Map<string, Connection>();

  async loadManifest(pluginDirectory: string): Promise<{ manifest: PluginManifest; path: string }> {
    const path = resolve(pluginDirectory);
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(path, "xpaw.plugin.json"), "utf8")));
    const main = resolve(path, manifest.main);
    if (!main.startsWith(`${path}\\`) && main !== path) throw new Error("插件入口必须位于插件目录内。");
    return { manifest, path };
  }

  async listTools(profile: PluginProfile, getAuthorization: (toolName: string) => PluginToolInfo["authorization"]): Promise<PluginToolInfo[]> {
    const result = await this.request(profile, "tools/list", {});
    const tools = z.object({ tools: z.array(toolSchema) }).parse(result).tools;
    return tools.map((tool) => ({ pluginId: profile.id, ...tool, authorization: getAuthorization(tool.name) }));
  }

  async callTool(profile: PluginProfile, name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request(profile, "tools/call", { name, arguments: args });
    const content = (result as { content?: unknown }).content;
    if (!Array.isArray(content)) return JSON.stringify(result);
    return content.map((item: unknown) => typeof item === "object" && item !== null && "text" in item ? String((item as { text: unknown }).text) : JSON.stringify(item)).join("\n");
  }

  getToolDefinitions(profiles: PluginProfile[], toolsByPlugin: Map<string, PluginToolInfo[]>): ToolDefinition[] {
    return profiles.filter((profile) => profile.enabled).flatMap((profile) => (toolsByPlugin.get(profile.id) ?? []).filter((tool) => tool.authorization !== "deny").map((tool) => ({
      type: "function" as const,
      function: { name: this.toolKey(profile.id, tool.name), description: `[Plugin:${profile.name}] ${tool.description}`, parameters: tool.inputSchema },
    })));
  }

  resolveTool(key: string): { pluginId: string; toolName: string } | undefined {
    const match = /^plugin_([^_]+(?:_[^_]+)*)__/.exec(key);
    if (!match) return undefined;
    const pluginId = match[1].replaceAll("_", "-");
    return { pluginId, toolName: key.slice(match[0].length) };
  }

  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    connection.process.kill();
  }

  private async request(profile: PluginProfile, method: string, params: Record<string, unknown>): Promise<unknown> {
    const connection = await this.connect(profile);
    const id = crypto.randomUUID();
    const response = new Promise<unknown>((resolveRequest, rejectRequest) => {
      connection.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      setTimeout(() => { if (connection.pending.delete(id)) rejectRequest(new Error("插件 RPC 超过 30 秒未响应。")); }, 30_000);
    });
    connection.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  }

  private async connect(profile: PluginProfile): Promise<Connection> {
    const existing = this.connections.get(profile.id);
    if (existing) return existing;
    const manifest = await this.loadManifest(profile.path);
    const executable = process.execPath;
    const child = spawn(executable, [resolve(manifest.path, manifest.manifest.main)], { cwd: manifest.path, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const connection: Connection = { process: child, pending: new Map(), buffer: "" };
    child.stdout.on("data", (chunk: Buffer) => {
      connection.buffer += chunk.toString("utf8");
      const lines = connection.buffer.split(/\r?\n/);
      connection.buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as { id?: string; result?: unknown; error?: { message?: string } };
          if (!message.id) continue;
          const pending = connection.pending.get(message.id);
          if (!pending) continue;
          connection.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message || "插件返回错误。"));
          else pending.resolve(message.result);
        } catch { /* Ignore plugin stdout lines that are not protocol messages. */ }
      }
    });
    child.once("exit", () => {
      this.connections.delete(profile.id);
      for (const pending of connection.pending.values()) pending.reject(new Error("插件进程已退出。"));
      connection.pending.clear();
    });
    this.connections.set(profile.id, connection);
    return connection;
  }

  private toolKey(pluginId: string, toolName: string): string {
    return `plugin_${pluginId.replaceAll("-", "_")}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}
