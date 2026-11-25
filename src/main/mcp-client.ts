import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerProfile, McpToolInfo } from "../types.js";
import type { ToolDefinition } from "../types.js";

type ConnectedServer = { client: Client; transport: StdioClientTransport };

export class McpClientManager {
  private readonly connections = new Map<string, ConnectedServer>();
  private readonly tools = new Map<string, McpToolInfo[]>();
  private readonly toolKeys = new Map<string, { serverId: string; toolName: string }>();

  async listTools(profile: McpServerProfile, getAuthorization: (toolName: string) => McpToolInfo["authorization"]): Promise<McpToolInfo[]> {
    const connection = await this.connect(profile);
    const result = await connection.client.listTools();
    const tools = result.tools.map((tool) => ({
      serverId: profile.id,
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
      authorization: getAuthorization(tool.name),
    }));
    this.tools.set(profile.id, tools);
    return tools;
  }

  async callTool(profile: McpServerProfile, name: string, args: Record<string, unknown>): Promise<string> {
    const connection = await this.connect(profile);
    const result = await connection.client.callTool({ name, arguments: args });
    const content = (result as { content?: unknown }).content;
    if (!Array.isArray(content)) return JSON.stringify(result);
    return content.map((item: unknown) => {
      if (typeof item === "object" && item !== null && "type" in item && (item as { type?: unknown }).type === "text" && "text" in item) return String((item as { text: unknown }).text);
      return JSON.stringify(item);
    }).join("\n");
  }

  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    this.tools.delete(id);
    await connection.transport.close();
  }

  getAuthorizedToolDefinitions(profiles: McpServerProfile[], getAuthorization: (serverId: string, toolName: string) => McpToolInfo["authorization"]): ToolDefinition[] {
    return profiles.filter((server) => server.enabled).flatMap((server) => (this.tools.get(server.id) ?? [])
      .filter((tool) => getAuthorization(server.id, tool.name) !== "deny")
      .map((tool) => {
        const name = this.toolKey(server.id, tool.name);
        this.toolKeys.set(name, { serverId: server.id, toolName: tool.name });
        return { type: "function" as const, function: { name, description: `[MCP:${server.name}] ${tool.description}`, parameters: tool.inputSchema } };
      }));
  }

  resolveTool(key: string): { serverId: string; toolName: string } | undefined {
    return this.toolKeys.get(key);
  }

  private toolKey(serverId: string, toolName: string): string {
    return `mcp_${serverId}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private async connect(profile: McpServerProfile): Promise<ConnectedServer> {
    const existing = this.connections.get(profile.id);
    if (existing) return existing;
    if (profile.transport !== "stdio" || !profile.command) throw new Error("当前 v0.6 仅支持已明确配置的本地 stdio MCP Server。");
    const client = new Client({ name: "XPaw", version: "0.6.0" });
    const transport = new StdioClientTransport({ command: profile.command, args: profile.args, stderr: "pipe" });
    await client.connect(transport);
    const connection = { client, transport };
    this.connections.set(profile.id, connection);
    return connection;
  }
}
