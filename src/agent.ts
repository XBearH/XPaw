import type { XPawDatabase } from "./database.js";
import { toolDefinitions, WorkspaceTools } from "./tools.js";
import type { AgentStreamEvent, ChatMessage, ModelClient, ToolCall, ToolResult } from "./types.js";

export type Confirm = (question: string) => Promise<boolean>;
const TOOL_TIMEOUT_MS = 60_000;

export class Agent {
  constructor(
    private readonly model: ModelClient,
    private readonly database: XPawDatabase,
    private readonly tools: WorkspaceTools,
    private readonly confirm: Confirm,
    private readonly systemPrompt: string,
    private readonly modelInfo: { provider: string; modelId: string } = { provider: "unknown", modelId: "unknown" },
  ) {}

  async respond(conversationId: number, userInput: string): Promise<string> {
    this.database.saveMessage(conversationId, { role: "user", content: userInput });
    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      ...this.database.getMessages(conversationId),
    ];

    for (let step = 0; step < 12; step += 1) {
      const startedAt = Date.now();
      let response;
      try {
        response = await this.model.chat(messages, toolDefinitions);
        this.database.recordModelRun({
          conversationId,
          provider: this.modelInfo.provider,
          modelId: this.modelInfo.modelId,
          ...response.usage,
          durationMs: Date.now() - startedAt,
          status: "completed",
        });
      } catch (error) {
        this.database.recordModelRun({
          conversationId, provider: this.modelInfo.provider, modelId: this.modelInfo.modelId,
          durationMs: Date.now() - startedAt, status: "failed",
        });
        throw error;
      }
      if (response.toolCalls.length === 0) {
        const content = response.content || "I did not receive a usable response from the model.";
        this.database.saveMessage(conversationId, { role: "assistant", content });
        return content;
      }

      messages.push({ role: "assistant", content: response.content ?? "", toolCalls: response.toolCalls });
      for (const call of response.toolCalls) {
        const result = await this.executeTool(conversationId, call);
        const toolMessage: ChatMessage = {
          role: "tool",
          content: `${call.function.name}: ${result.content}`,
          toolCallId: call.id,
        };
        messages.push(toolMessage);
      }
    }

    const content = "I stopped because the task exceeded the safety limit of 12 tool calls.";
    this.database.saveMessage(conversationId, { role: "assistant", content });
    return content;
  }

  async *streamRespond(conversationId: number, userInput: string, signal?: AbortSignal, taskId?: number, saveUser = true): AsyncGenerator<AgentStreamEvent> {
    if (saveUser) this.database.saveMessage(conversationId, { role: "user", content: userInput });
    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt }, ...this.database.getMessages(conversationId)];
    let finalContent = "";
    if (taskId) {
      const plan = this.buildPlan(userInput);
      this.database.updateTask(taskId, "planning", { plan });
      this.database.addTaskEvent(taskId, "plan", plan);
      this.database.updateTask(taskId, "running");
      this.database.addTaskEvent(taskId, "running", "开始执行任务。");
    }
    try {
      for (let step = 0; step < 12; step += 1) {
        if (signal?.aborted) { if (taskId) { this.database.updateTask(taskId, "cancelled"); this.database.addTaskEvent(taskId, "cancelled", "用户停止了任务。"); } yield { type: "cancelled" }; return; }
        const startedAt = Date.now();
        let response;
        try {
          const stream = this.model.streamChat(messages, toolDefinitions, signal);
          for await (const event of stream) {
            if (event.type === "text_delta") { finalContent += event.delta; yield event; }
            else response = event.response;
          }
          if (!response) throw new Error("The model stream ended without a final response.");
          this.database.recordModelRun({ conversationId, provider: this.modelInfo.provider, modelId: this.modelInfo.modelId, ...response.usage, durationMs: Date.now() - startedAt, status: "completed" });
        } catch (error) {
          if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            this.database.recordModelRun({ conversationId, provider: this.modelInfo.provider, modelId: this.modelInfo.modelId, durationMs: Date.now() - startedAt, status: "cancelled" });
            if (taskId) { this.database.updateTask(taskId, "cancelled"); this.database.addTaskEvent(taskId, "cancelled", "模型请求被取消或超时。 "); }
            yield { type: "cancelled" };
            return;
          }
          this.database.recordModelRun({ conversationId, provider: this.modelInfo.provider, modelId: this.modelInfo.modelId, durationMs: Date.now() - startedAt, status: "failed" });
          if (taskId) { this.database.updateTask(taskId, "failed", { error: error instanceof Error ? error.message : String(error) }); this.database.addTaskEvent(taskId, "failed", "模型请求失败。", { error: error instanceof Error ? error.message : String(error) }); }
          throw error;
        }
        if (response.toolCalls.length === 0) {
          const content = finalContent || response.content || "I did not receive a usable response from the model.";
          this.database.saveMessage(conversationId, { role: "assistant", content });
          if (taskId) { this.database.updateTask(taskId, "completed"); this.database.addTaskEvent(taskId, "completed", "任务已完成。", { usage: response.usage }); }
          yield { type: "completed", content, usage: response.usage };
          return;
        }
        messages.push({ role: "assistant", content: response.content ?? "", toolCalls: response.toolCalls });
        finalContent = "";
        for (const call of response.toolCalls) {
          if (taskId && call.function.name === "write_file") { this.database.updateTask(taskId, "awaiting_confirmation"); this.database.addTaskEvent(taskId, "awaiting_confirmation", "等待用户确认文件写入。", { tool: call.function.name }); }
          yield { type: "tool_started", name: call.function.name };
          const result = await this.executeTool(conversationId, call);
          if (taskId) { this.database.updateTask(taskId, "running"); this.database.addTaskEvent(taskId, "tool", `${call.function.name}：${result.summary}`); }
          messages.push({ role: "tool", content: `${call.function.name}: ${result.content}`, toolCallId: call.id });
          yield { type: "tool_finished", name: call.function.name, summary: result.summary };
        }
      }
      const content = "I stopped because the task exceeded the safety limit of 12 tool calls.";
      this.database.saveMessage(conversationId, { role: "assistant", content });
      if (taskId) { this.database.updateTask(taskId, "failed", { error: content }); this.database.addTaskEvent(taskId, "failed", content); }
      yield { type: "completed", content };
    } catch (error) {
      if (taskId) { this.database.updateTask(taskId, "failed", { error: error instanceof Error ? error.message : String(error) }); this.database.addTaskEvent(taskId, "failed", "任务运行时异常。", { error: error instanceof Error ? error.message : String(error) }); }
      yield { type: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async executeTool(conversationId: number, call: ToolCall): Promise<ToolResult> {
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      return this.recordFailure(conversationId, call, "Tool arguments were not valid JSON.");
    }

    const toolName = call.function.name;
    if (!["list_files", "read_file", "search_files", "write_file"].includes(toolName)) {
      return this.recordFailure(conversationId, call, `Tool ${toolName} is not available.`);
    }

    let authorizationState: "approved" | "denied" | "not_required" = "not_required";
    if (toolName === "write_file") {
      authorizationState = await this.confirmWrite(args) ? "approved" : "denied";
      if (authorizationState === "denied") {
        const message = "The user declined permission to write this file.";
        this.database.auditToolRun({
          conversationId, toolName, argumentsJson: JSON.stringify(args), authorizationState, status: "cancelled", error: message,
        });
        return { content: message, summary: message };
      }
    }

    try {
      const operation = toolName === "list_files" ? this.tools.listFiles(args)
        : toolName === "read_file" ? this.tools.readFile(args)
          : toolName === "search_files" ? this.tools.searchFiles(args)
            : this.tools.writeFile(args);
      const result = await this.withTimeout(operation, `${toolName} exceeded the 60 second tool timeout.`);
      this.database.auditToolRun({
        conversationId, toolName, argumentsJson: JSON.stringify(args), authorizationState, status: "completed", resultSummary: result.summary,
      });
      return result;
    } catch (error) {
      return this.recordFailure(conversationId, call, error instanceof Error ? error.message : String(error), authorizationState, args);
    }
  }

  private async confirmWrite(args: unknown): Promise<boolean> {
    const object = args as { path?: unknown; content?: unknown };
    const path = typeof object.path === "string" ? object.path : "(invalid path)";
    const content = typeof object.content === "string" ? object.content : "";
    const preview = content.length > 1_000 ? `${content.slice(0, 1_000)}\n[preview truncated]` : content;
    return this.confirm(`\nXPaw requests permission to write: ${path}\n--- content preview ---\n${preview}\n--- end preview ---\nApprove?`);
  }

  private recordFailure(
    conversationId: number,
    call: ToolCall,
    error: string,
    authorizationState: "approved" | "denied" | "not_required" = "not_required",
    args: unknown = {},
  ): ToolResult {
    this.database.auditToolRun({
      conversationId, toolName: call.function.name, argumentsJson: JSON.stringify(args), authorizationState, status: "failed", error,
    });
    return { content: `Tool failed: ${error}`, summary: `Failed: ${error}` };
  }

  private buildPlan(objective: string): string {
    const text = objective.toLowerCase();
    const steps = ["理解请求和现有会话上下文"];
    if (/读|读取|查看|总结|搜索|查找|文件|read|search|list/.test(text)) steps.push("在授权工作区内检查相关文件");
    if (/写|创建|保存|更新|修改|write|create|save|update/.test(text)) steps.push("准备变更，并在写入前请求确认");
    steps.push("返回可验证的结果、限制或失败原因");
    return steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  }

  private async withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), TOOL_TIMEOUT_MS); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
