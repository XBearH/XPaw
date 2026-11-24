# XPaw

XPaw is a local-first terminal AI character agent. Version `0.1.0` is intentionally small: it loads a validated character card, chats through a local Ollama-compatible API, stores sessions in SQLite, and exposes file tools only inside an explicit workspace.

## v0.1 capabilities

- YAML character cards validated with Zod.
- Ollama OpenAI-compatible chat endpoint.
- Persistent conversations and tool audit records in local SQLite.
- Read, list, and search files only inside a configured workspace.
- Write files only after explicit terminal confirmation.
- Path traversal protection and a hard limit of 12 tool calls per request.

## Requirements

- Node.js 22 or later.
- [Ollama](https://ollama.com/) running locally.
- A tool-capable model pulled in Ollama, such as `qwen3:8b`.

## Start

```powershell
Copy-Item .env.example .env
npm install
ollama pull qwen3:8b
ollama serve
npm run dev
```

On Windows, leave `ollama serve` out when the Ollama desktop application is already running. The default endpoint is `http://127.0.0.1:11434/v1` and the default model is `qwen3:8b`.

XPaw creates local runtime data under `data/`, and uses `workspace/` as its default authorized directory. Both are intentionally ignored by Git.

## Configuration

Set these variables in `.env` when necessary:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODEL=qwen3:8b
XPAW_WORKSPACE=C:\Users\your-name\Documents\XPawWorkspace
```

`XPAW_WORKSPACE` must point to a directory you deliberately authorize. XPaw rejects read, search, and write paths outside it.

## Commands

```powershell
npm run dev       # start terminal XPaw
npm run build     # type-check and compile TypeScript
npm test          # run safety and character-card tests
npm run lint      # run TypeScript type checks without output
```

Type `/exit` to end a chat session.

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
