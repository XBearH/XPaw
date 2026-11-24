import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import type { XPawDatabase } from "../src/database.js";
import type { OllamaClient } from "../src/ollama.js";
import type { WorkspaceTools } from "../src/tools.js";

describe("Agent", () => {
  it("returns a model answer after supplying a tool result in the same request", async () => {
    const requests: unknown[] = [];
    const model = {
      chat: async (messages: unknown[]) => {
        requests.push(messages);
        if (requests.length === 1) {
          return {
            content: null,
            toolCalls: [{ id: "call_1", type: "function" as const, function: { name: "read_file", arguments: '{"path":"note.txt"}' } }],
          };
        }
        return { content: "The note says hello.", toolCalls: [] };
      },
    } as unknown as OllamaClient;
    const savedMessages: unknown[] = [];
    const database = {
      saveMessage: (_conversationId: number, message: unknown) => savedMessages.push(message),
      getMessages: () => [],
      auditToolRun: () => undefined,
    } as unknown as XPawDatabase;
    const tools = {
      readFile: async () => ({ content: "hello", summary: "Read note.txt." }),
    } as unknown as WorkspaceTools;
    const agent = new Agent(model, database, tools, async () => false, "system prompt");

    await expect(agent.respond(1, "Read the note.")).resolves.toBe("The note says hello.");
    expect(requests).toHaveLength(2);
    expect(savedMessages).toContainEqual({ role: "assistant", content: "The note says hello." });
  });
});
