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
  });
});
