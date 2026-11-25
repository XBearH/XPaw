# XPaw

XPaw is a local-first desktop AI character and task agent. It supports ordinary conversation and fictional roleplay as well as permission-gated local tasks. Characters, conversations, task audits, and usage records stay on the device by default.

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
