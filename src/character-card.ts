import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

const characterCardSchema = z.object({
  spec_version: z.literal(1),
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens."),
  name: z.string().min(1),
  description: z.string().min(1),
  identity: z.object({
    role: z.string().min(1),
    summary: z.string().min(1),
  }),
  personality: z.object({
    traits: z.array(z.string().min(1)).min(1),
    speaking_style: z.object({
      language: z.string().min(1),
      tone: z.string().min(1),
    }),
    boundaries: z.array(z.string().min(1)).min(1),
  }),
  goals: z.object({ primary: z.array(z.string().min(1)).min(1) }),
  tool_policy: z.object({
    allowed_tools: z.array(z.string()),
    confirmation_required: z.array(z.string()),
    forbidden: z.array(z.string()),
  }),
  memory_policy: z.object({
    confirmation_required: z.boolean(),
    remember: z.array(z.string()),
    forget: z.array(z.string()),
  }),
  example_dialogues: z.array(z.object({ user: z.string(), assistant: z.string() })).default([]),
});

export type CharacterCard = z.infer<typeof characterCardSchema>;

export async function loadCharacterCard(path: string): Promise<CharacterCard> {
  const text = await readFile(path, "utf8");
  const extension = extname(path).toLowerCase();
  const parsed: unknown = extension === ".json" ? JSON.parse(text) : yaml.load(text);
  return characterCardSchema.parse(parsed);
}

export function compileSystemPrompt(card: CharacterCard, workspacePath: string): string {
  const examples = card.example_dialogues
    .map((example) => `User: ${example.user}\nAssistant: ${example.assistant}`)
    .join("\n\n");

  return `You are ${card.name}, ${card.identity.role}.\n\n` +
    `Identity: ${card.identity.summary}\n` +
    `Description: ${card.description}\n` +
    `Traits: ${card.personality.traits.join(", ")}\n` +
    `Language: ${card.personality.speaking_style.language}\n` +
    `Tone: ${card.personality.speaking_style.tone}\n\n` +
    `Primary goals:\n${card.goals.primary.map((goal) => `- ${goal}`).join("\n")}\n\n` +
    `Operational boundaries:\n${card.personality.boundaries.map((item) => `- ${item}`).join("\n")}\n` +
    `- You can access files only through the provided tools and only inside this workspace: ${workspacePath}\n` +
    `- When the user asks to list, read, find, search, inspect, or summarize workspace files, call the relevant file tool before answering.\n` +
    `- Only call write_file when the user explicitly asks to create, save, update, or overwrite a file. Never write a summary or other output unless explicitly requested.\n` +
    `- Never invent file contents, tool results, or completed actions.\n` +
    `- Writing files requires explicit confirmation from the user in the terminal.\n` +
    `- Do not request, store, or reveal passwords, API keys, verification codes, or other secrets.\n\n` +
    `Tool policy:\n` +
    `- Allowed: ${card.tool_policy.allowed_tools.join(", ") || "none"}\n` +
    `- Confirmation required: ${card.tool_policy.confirmation_required.join(", ") || "none"}\n` +
    `- Forbidden: ${card.tool_policy.forbidden.join(", ") || "none"}\n` +
    (examples ? `\nExamples:\n${examples}\n` : "");
}

export function characterDisplayName(card: CharacterCard): string {
  return `${card.name} (${basename(card.id)})`;
}
