# XPaw

XPaw is a local-first terminal AI character agent. Version `0.1.0` is intentionally small: it loads a validated character card, chats through a local Ollama-compatible API, stores sessions in SQLite, and exposes file tools only inside an explicit workspace.

## v0.1 capabilities

- YAML character cards validated with Zod.
- Ollama and external OpenAI-compatible chat endpoints.
- Persistent conversations and tool audit records in local SQLite.
- Read, list, and search files only inside a configured workspace.
- Write files only after explicit terminal confirmation.
- Path traversal protection and a hard limit of 12 tool calls per request.

## Requirements

- Node.js 22 or later.
- [Ollama](https://ollama.com/) running locally, or an external OpenAI-compatible API.
- A tool-capable model. The local configuration uses `qwen2.5:3b`.

## Start

On the current machine, Ollama and `qwen2.5:3b` are already installed and the local Ollama server is running. Start XPaw with:

```powershell
Set-Location D:\XPaw
npm run dev
```

For a fresh machine:

```powershell
Copy-Item .env.example .env
npm install
& 'D:\Ollama\ollama.exe' pull qwen2.5:3b
ollama serve
npm run dev
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

To use an external API which implements the OpenAI Chat Completions tool-calling format:

```dotenv
XPAW_MODEL_PROVIDER=openai-compatible
XPAW_MODEL_BASE_URL=https://your-provider.example/v1
XPAW_MODEL_NAME=your-tool-capable-model
XPAW_MODEL_API_KEY=your-secret-key
```

The API key stays in your ignored local `.env`. XPaw sends the current conversation, selected character prompt, and tool definitions to an external provider when this option is enabled. Do not use an external API until you understand that data boundary.

`XPAW_WORKSPACE` must point to a directory you deliberately authorize. XPaw rejects read, search, and write paths outside it.

## Commands

```powershell
npm run dev       # start terminal XPaw
npm run build     # type-check and compile TypeScript
npm test          # run safety and character-card tests
npm run lint      # run TypeScript type checks without output
```

Type `/exit` to end a chat session.

## Use XPaw

1. Put a text file in the configured `workspace/` directory.
2. Run `npm run dev` from `D:\XPaw`.
3. Ask an explicit task, such as `读取 notes.md 并用中文总结` or `在 workspace 中创建 todo.md，内容是...`.
4. For every write request, read the displayed path and content preview. Enter `y` only when both are correct; press Enter or type anything else to deny it.

XPaw v0.1 is a terminal application. It is ready for normal small-scale use within its defined scope: chat, workspace file listing/reading/searching, and confirmation-gated text-file writes. Its local 3B model is reliable enough for explicit file-tool requests; phrase file actions clearly rather than relying on broad requests such as "organize everything".

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
- `write_file` displays the requested content and requires `y` approval.
- Delete operations, shell commands, network tools, plugins, and automatic memory are not part of v0.1.
- API keys belong in `.env` or a future OS credential store, never in character cards or Git.

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
