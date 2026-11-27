# XPaw

XPaw is a local-first desktop AI character and task agent. It supports ordinary conversation and fictional roleplay as well as permission-gated local tasks. Characters, conversations, task audits, and usage records stay on the device by default.

Current development line: `v1.0-alpha`. See [CHANGELOG.md](CHANGELOG.md) for public milestone notes.

## Current Features

- Electron + React desktop application with streamed model output and stop generation.
- Character cards validated with Zod, plus local character overrides for identity and speaking style.
- Natural conversation and fictional roleplay without requiring a file task.
- Local Ollama profiles and OpenAI-compatible cloud model profiles.
- Encrypted cloud API keys through Electron safe storage; keys are not stored in SQLite, character cards, or Git.
- Persistent conversations: create, restore, rename, delete, copy an answer, and regenerate the latest answer.
- Token usage summary and daily heatmap, filterable by model and date range.
- Persistent agent tasks with plans, confirmations, tool events, cancellation, time limits, audit history, and safe rerun.
- Workspace-scoped file list, read, search, and confirmation-gated text-file write tools.
- User profile, explicit long-term memories, local memory search, and manageable conversation summaries.
- Local text knowledge base with document chunks, FTS5 search, and source citations.
- Controlled MCP client for local stdio tool servers with per-tool authorization.
- Local Plugin SDK with manifest validation, isolated Node processes, JSON Lines RPC, and per-tool authorization.
- Appearance preferences: light, dark, system-following modes, and a local custom accent color.
- v0.9 model capability metadata and mode-specific model defaults.
- Portable JSON data export that excludes API keys, secrets, plugin/MCP permissions, and workspace files.
- Versioned character card import/export and separate world book assets for roleplay.
- Companion layer with editable relationship, boundaries, fictional scene state, and scene checkpoints.
- Optional automatic startup of the local Ollama service from the desktop app.

## Requirements

- Node.js 22 or later.
- [Ollama](https://ollama.com/) running locally, or an external OpenAI-compatible API.
- A tool-capable model. The local configuration uses `qwen2.5:3b`.

## Start

On the current machine, Ollama and `qwen2.5:3b` are already installed. Start the desktop application with:

```powershell
Set-Location D:\XPaw
npm run desktop
```

For a fresh machine:

```powershell
Copy-Item .env.example .env
npm install
& 'D:\Ollama\ollama.exe' pull qwen2.5:3b
ollama serve
npm run desktop
```

On this machine Ollama is installed at `D:\Ollama` and models are stored at `D:\OllamaModels`. The local server is already running. The default endpoint is `http://127.0.0.1:11434/v1` and the default model is `qwen2.5:3b`.

XPaw creates local runtime data under `data/`, and uses `workspace/` as its default authorized directory. Both are intentionally ignored by Git.

## Configuration

Set these variables in `.env` when necessary:

```dotenv
XPAW_MODEL_PROVIDER=ollama
XPAW_MODEL_BASE_URL=http://127.0.0.1:11434/v1
XPAW_MODEL_NAME=qwen2.5:3b
XPAW_WORKSPACE=C:\Users\your-name\Documents\XPawWorkspace
```

External OpenAI-compatible providers are configured from the desktop settings page. API keys are encrypted by Electron safe storage and are never saved to `.env`, SQLite, a character card, or Git. Enabling a cloud model sends the character prompt, conversation, tool definitions, and relevant tool results to that provider.

`XPAW_WORKSPACE` must point to a directory you deliberately authorize. XPaw rejects read, search, and write paths outside it.

## Commands

```powershell
npm run dev       # start terminal XPaw
npm run build     # type-check and compile TypeScript
npm test          # run safety and character-card tests
npm run lint      # run TypeScript type checks without output
npm run desktop   # launch the Electron desktop application
npm run desktop:build # build the Electron main process, preload, and React renderer
```

Type `/exit` to end a chat session.

## Desktop Use

```powershell
Set-Location D:\XPaw
npm run desktop
```

The desktop application manages model profiles, character settings, conversations, tasks, and token usage. A cloud connection must pass a small test request before XPaw saves the profile.

## Use XPaw

1. Put a text file in the configured `workspace/` directory.
2. Run `npm run dev` from `D:\XPaw`.
3. Ask an explicit task, such as `读取 notes.md 并用中文总结` or `在 workspace 中创建 todo.md，内容是...`.
4. For every write request, read the displayed path and content preview. Enter `y` only when both are correct; press Enter or type anything else to deny it.

XPaw is ready for normal small-scale use within its current scope: chat, roleplay, workspace file list/read/search, and confirmation-gated text-file writes. The local 3B model is best with explicit requests. Phrase file operations clearly rather than relying on broad requests such as "organize everything".

## Task Runtime

Each request is tracked as a local task. XPaw records a visible plan, tool activity, confirmation waits, failures, cancellation, and completion. Limits are deliberately conservative:

- Maximum 12 tool calls per task.
- Maximum 120 seconds per model request.
- Maximum 60 seconds per tool call.
- Maximum 5 minutes for a complete task.
- Tasks interrupted by application shutdown are marked `interrupted`; the UI can safely rerun the original request but never guesses how to continue from an uncertain intermediate step.

## Memory

XPaw keeps memory controllable and local:

- User profile fields such as preferred name, language, timezone, and communication style are explicit and editable.
- Long-term memories are created, edited, and deleted by the user from the memory page.
- Relevant memories are retrieved locally for a new request. XPaw injects at most five matching user-approved memories.
- Passwords, verification codes, API keys, and access tokens must not be saved as memories.
- Long conversations are summarized after a conservative threshold. The summary is visible and can be deleted from the memory page.

## Local Knowledge Base

XPaw can index user-selected local text files without copying the original files into the project. Version `v0.5` supports UTF-8 `.txt`, `.md`, `.json`, `.csv`, `.yaml`, and `.yml` files up to 5 MB. Documents are split into local SQLite FTS5 chunks. When relevant excerpts are used, XPaw is instructed to cite them as `[来源：filename:line]`.

PDF, DOCX, XLSX, OCR, embeddings, and vector search are intentionally not included yet. The knowledge page clearly rejects unsupported formats instead of pretending to parse them.

## MCP Client

XPaw can connect to a user-configured local stdio MCP Server. A connection starts with tool discovery only: tools are not automatically trusted. Each discovered tool has an explicit authorization state:

- `ask`: request desktop approval for every call.
- `always`: allow the tool to run after the user explicitly selects persistent approval.
- `deny`: do not expose the tool to the agent.

MCP calls use the existing task audit, confirmation, cancellation, and tool timeout boundaries. Version `v0.6` intentionally does not install MCP packages automatically and does not enable remote HTTP MCP calls. Remote MCP needs a separate data disclosure and authentication design before it can be enabled.

## Plugin SDK

Plugins are local directories added manually from the desktop plugin page. Every plugin needs an `xpaw.plugin.json` manifest:

```json
{
  "id": "example-echo",
  "name": "Echo Example",
  "version": "0.1.0",
  "main": "index.js",
  "permissions": []
}
```

XPaw launches the declared entry in an isolated Node child process. The plugin communicates only through JSON Lines RPC using `tools/list` and `tools/call`; it does not receive XPaw's Electron IPC, database connection, model keys, or main-process APIs. Plugin tools default to `ask`, and use the same audit, confirmation, cancellation, and timeout boundaries as built-in and MCP tools. See [`examples/echo-plugin`](examples/echo-plugin) for a minimal protocol example.

## Companion And Roleplay Direction

XPaw currently supports ordinary conversation and fictional roleplay through each character card. The agent runtime remains deliberately separate from roleplay: fictional scene events do not become real device actions, and real tools are invoked only for explicit requests.

The next companion-focused releases will build on this boundary with:

- Per-character relationship and scene continuity that is visible and editable by the user.
- Roleplay-specific context policies that preserve setting details without treating fictional events as factual user memories.
- Character creation templates for companionship, collaborative work, and story scenes.
- Clear transitions between chat, roleplay, and task execution, so the assistant does not abruptly turn a scene into an automation workflow.
- Optional richer local or cloud models selected through the existing model profile system.

The visual direction is intentionally XPaw-specific: a restrained companion-focused entry point and paw mark, not a copy of another product's brand, text, or media.

## Appearance

Open desktop settings to choose light mode, dark mode, or follow-system mode. You can also select a custom accent color. Appearance settings are stored locally in the desktop application's browser storage and do not affect character cards or shared project data.

## v0.9 Model And Data Controls

Model profiles can carry capability metadata such as thinking support, tool support, roleplay suitability, and context window size. XPaw also stores separate default profiles for conversation, roleplay, and task modes. These settings are used to make model suitability visible; they do not make a small model smarter by themselves.

The desktop runtime provides a portable JSON export for conversations, tasks, memories, knowledge indexes, character overrides, companion state, scene checkpoints, and non-secret model settings. API keys, encrypted secret storage, plugin/MCP permissions, and workspace files are deliberately excluded.

## Companion Layer

The companion page keeps fictional roleplay state separate from real user memory. You can edit the relationship label, interaction boundaries, scene title, setting, and scene summary, then save scene checkpoints. In `Roleplay` mode XPaw does not expose real file, MCP, or plugin tools to the model. Use `Task` mode for real-world operations.

## Character Cards And World Books

XPaw separates roleplay data into three assets:

- **Character card**: who the character is, including identity, personality, boundaries, goals, and examples.
- **World book**: what the fictional world is, including its rules, locations, history, factions, and keyword-triggered entries.
- **Companion state**: what is happening now, including relationship label, current scene, summary, and checkpoints.

Character cards can be imported from JSON or YAML, validated, and migrated to XPaw card spec v2. They can be exported without model settings, workspace permissions, API keys, or other machine-specific data. World book entries are injected only in roleplay mode when their keywords match the current user message.

Scene checkpoints can be preserved as named fictional branches and later restored. Restoring a branch changes only companion/roleplay state; it does not modify user memory or run any real tool.

## Ollama Startup

When the active profile is local Ollama, XPaw checks the local API during desktop startup. If it is unavailable and the setting is enabled, XPaw starts `D:\Ollama\ollama.exe serve` with the configured local model directory and waits for the API. The setting can be disabled in desktop settings. XPaw does not stop an Ollama service it did not start.

If a reboot stops the local model server, first launch the Ollama application, or run the following in a separate PowerShell window while the iKuuuVPN local proxy is available:

```powershell
$env:OLLAMA_MODELS = 'D:\OllamaModels'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
& 'D:\Ollama\ollama.exe' serve
```

## Security Boundaries

- The model does not directly receive Node.js filesystem access.
- Every tool argument is parsed before execution.
- File paths are resolved and checked against the configured workspace.
- `write_file` displays the requested content and requires explicit approval in the terminal or desktop dialog.
- Delete operations, shell commands, network tools, plugins, and automatic memory are not implemented.
- Cloud API keys are encrypted locally and never exported through profiles or character cards.
- Roleplay is fictional conversation. It cannot claim to have changed real files or devices without a verified tool result.

## Project Layout

```text
characters/       Versioned, shareable character cards
src/              TypeScript application code
tests/            Automated safety tests
workspace/        Default authorized working directory, ignored except .gitkeep
data/             Runtime SQLite database, ignored
docs/             Public project documentation
```

## License

Apache-2.0. See [LICENSE](LICENSE).
