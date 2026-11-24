import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Agent } from "./agent.js";
import { compileSystemPrompt, loadCharacterCard } from "./character-card.js";
import { XPawDatabase } from "./database.js";
import { OpenAiCompatibleClient } from "./ollama.js";
import { WorkspaceTools } from "./tools.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspacePath = resolve(process.env.XPAW_WORKSPACE || join(projectRoot, "workspace"));
const characterPath = join(projectRoot, "characters", "default.yaml");
const databasePath = join(projectRoot, "data", "xpaw.sqlite");
const provider = process.env.XPAW_MODEL_PROVIDER || "ollama";
const baseUrl = process.env.XPAW_MODEL_BASE_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
const modelName = process.env.XPAW_MODEL_NAME || process.env.OLLAMA_MODEL || "qwen2.5:3b";
const apiKey = process.env.XPAW_MODEL_API_KEY;

async function main(): Promise<void> {
  await mkdir(workspacePath, { recursive: true });
  const character = await loadCharacterCard(characterPath);
  const database = new XPawDatabase(databasePath);
  const readline = createInterface({ input, output });
  const conversationId = database.createConversation(character.id, "Terminal session");
  const agent = new Agent(
    new OpenAiCompatibleClient(baseUrl, modelName, apiKey),
    database,
    new WorkspaceTools(workspacePath),
    async (question) => (await readline.question(`${question} [y/N] `)).trim().toLowerCase() === "y",
    compileSystemPrompt(character, workspacePath),
    { provider, modelId: modelName },
  );

  console.log(`\n${character.name} v0.1`);
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Model provider: ${provider}`);
  console.log(`Model: ${modelName} at ${baseUrl}`);
  console.log("Type /exit to close. Write actions always require confirmation.\n");

  try {
    while (true) {
      let request: string;
      try {
        request = (await readline.question("You> ")).trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") break;
        throw error;
      }
      if (!request) continue;
      if (request === "/exit") break;
      try {
        const answer = await agent.respond(conversationId, request);
        console.log(`\n${character.name}> ${answer}\n`);
      } catch (error) {
        console.error(`\nRequest failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    readline.close();
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
