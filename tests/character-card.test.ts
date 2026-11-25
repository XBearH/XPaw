import { describe, expect, it } from "vitest";
import { compileSystemPrompt } from "../src/character-card.js";

describe("compileSystemPrompt", () => {
  it("includes the card's safety boundaries and workspace", () => {
    const prompt = compileSystemPrompt({
      spec_version: 1,
      id: "test-agent",
      name: "Test",
      description: "Test assistant",
      identity: { role: "Assistant", summary: "A test role" },
      personality: {
        traits: ["precise"],
        speaking_style: { language: "en", tone: "calm" },
        boundaries: ["Do not guess."],
      },
      goals: { primary: ["Help safely."] },
      tool_policy: { allowed_tools: ["filesystem.read"], confirmation_required: ["filesystem.write"], forbidden: ["shell.execute"] },
      memory_policy: { confirmation_required: true, remember: [], forget: [] },
      example_dialogues: [],
    }, "D:/Workspace");

    expect(prompt).toContain("D:/Workspace");
    expect(prompt).toContain("Do not guess.");
    expect(prompt).toContain("Writing files requires explicit confirmation");
    expect(prompt).toContain("call the relevant file tool before answering");
    expect(prompt).toContain("Only call write_file when the user explicitly asks");
    expect(prompt).toContain("You may engage in ordinary conversation and consensual fictional roleplay");
  });

  it("adds user-approved profile and memory context", () => {
    const prompt = compileSystemPrompt({
      spec_version: 1, id: "test-agent", name: "Test", description: "Test", identity: { role: "Assistant", summary: "Test" },
      personality: { traits: ["clear"], speaking_style: { language: "zh-CN", tone: "calm" }, boundaries: ["Be accurate."] },
      goals: { primary: ["Help."] }, tool_policy: { allowed_tools: [], confirmation_required: [], forbidden: [] }, memory_policy: { confirmation_required: true, remember: [], forget: [] }, example_dialogues: [],
    }, "D:/Workspace", { preferredName: "小熊", language: "zh-CN", timezone: "Asia/Shanghai", communicationStyle: "brief" }, [{ id: 1, category: "preference", content: "Use Chinese", source: "user", createdAt: "", updatedAt: "" }], "Earlier context");
    expect(prompt).toContain("Preferred name: 小熊");
    expect(prompt).toContain("Use Chinese");
    expect(prompt).toContain("Earlier context");
  });
});
