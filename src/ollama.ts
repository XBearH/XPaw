import type { ChatMessage, ModelClient, ModelResponse, ModelStreamEvent, ToolCall, ToolDefinition } from "./types.js";

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
  error?: { message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class OpenAiCompatibleClient implements ModelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
        })),
        tools,
        tool_choice: "auto",
        max_tokens: 384,
        temperature: 0.35,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json() as OpenAiResponse;
    if (!response.ok) throw new Error(data.error?.message || `Model request failed with status ${response.status}.`);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Model response did not include a message.");
    return {
      content: message.content ?? null,
      toolCalls: message.tool_calls ?? [],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async *streamChat(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): AsyncGenerator<ModelStreamEvent> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
        })),
        tools,
        tool_choice: "auto",
        max_tokens: 384,
        temperature: 0.35,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: signal ?? AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({})) as OpenAiResponse;
      throw new Error(data.error?.message || `Model request failed with status ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let content = "";
    const toolCalls = new Map<number, ToolCall>();
    let usage: ModelResponse["usage"];
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<Partial<ToolCall> & { index: number; function?: Partial<ToolCall["function"]> }> } }>; usage?: OpenAiResponse["usage"] };
        if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens };
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) { content += delta.content; yield { type: "text_delta", delta: delta.content }; }
        for (const partial of delta?.tool_calls ?? []) {
          const existing = toolCalls.get(partial.index) ?? { id: partial.id ?? `call_${partial.index}`, type: "function", function: { name: "", arguments: "" } };
          if (partial.id) existing.id = partial.id;
          if (partial.function?.name) existing.function.name += partial.function.name;
          if (partial.function?.arguments) existing.function.arguments += partial.function.arguments;
          toolCalls.set(partial.index, existing);
        }
      }
      if (done) break;
    }
    yield { type: "completed", response: { content, toolCalls: [...toolCalls.values()], usage } };
  }
}
