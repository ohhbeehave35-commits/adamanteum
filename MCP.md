# Use Adamanteum from any AI (MCP), and from anything else (the HTTP door)

Adamanteum keeps your notes and your code map. Any AI that speaks the Model Context Protocol (MCP) can search it, read it, follow its links and, if you allow, write to it. No account, no cloud: the server runs on your computer and talks to Adamanteum on your computer.

## Install: one block in one config file

1. Make a key for the AI (the owner does this once, on the machine that runs Adamanteum). A **read** key can look but never change anything:
   ```
   node adamantium-cli.mjs door mint my-ai --scope read --out C:\Users\you\.adamantium\door.token
   ```
   Use `--scope write` only for an AI you want to let write notes. Every call the AI makes is logged under the name you gave it.
2. Paste the `mcpServers` block into the AI app's MCP settings and restart the app. It looks like this:
   ```json
   {"mcpServers":{"adamanteum":{"command":"node","args":["C:/path/to/adamantium/mcp-server.mjs"],
     "env":{"ADAMANTIUM_DOOR_URL":"http://127.0.0.1:4173","ADAMANTIUM_DOOR_TOKEN_FILE":"C:/Users/you/.adamantium/door.token"}}}}
   ```

Needs Node 24 or newer. The server has no dependencies. Adamanteum itself must be running (`Launch Adamantium.cmd`).

### Other apps
| App | How |
|---|---|
| Claude Desktop | paste the block into `claude_desktop_config.json`, restart |
| Codex CLI | `codex mcp add adamanteum --env ADAMANTIUM_DOOR_URL=http://127.0.0.1:4173 --env ADAMANTIUM_DOOR_TOKEN_FILE=... -- node /path/mcp-server.mjs` |
| Grok Build | `grok mcp add adamanteum -e ADAMANTIUM_DOOR_URL=http://127.0.0.1:4173 -e ADAMANTIUM_DOOR_TOKEN_FILE=... -- node /path/mcp-server.mjs` |
| Cursor, Windsurf, others | same `mcpServers` block |
| A local model (Ollama, LM Studio) | any MCP-capable client that can drive it; see the Codex note below |

Tested so far: Grok Build with the xAI model `grok-4.6-build`; Codex CLI driving a local `qwen2.5:7b` through Ollama with the internet blocked. A small local model answers correctly but can invent details around the answer (it made up links); the tool results carry the real note path and sha256, so check those.

The hosted Adamanteum works the same way: set `ADAMANTIUM_DOOR_URL=https://<your-adamanteum-address>` and use a key from the company's Keys page.

## What the AI can do

| Tool | What it does |
|---|---|
| `adamantium_navigate` | Ask a question in plain words. It plans the search (decision, recent, code, how-to, lookup), narrows a large vault by the most selective words, dates, file names and folders, and returns ranked notes with why, line number, sha256, the matching decision lines, linked notes and the trail it took. **Start here.** |
| `adamantium_search` | Exact full-text search with operators. Every word must appear. |
| `adamantium_read_note` | A note's text, properties, tags, links, backlinks and sha256. |
| `adamantium_links` | What a note links to and what links to it. |
| `adamantium_context` | The note and the notes around it (up to 3 steps), or a code symbol's neighbourhood. |
| `adamantium_trace_path` | The shortest chain of links between two notes. |
| `adamantium_changed_since` | What changed since a time (`90m`, `24h`, `7d`, or a date). |
| `adamantium_link_health` | Broken links, orphans, duplicate names. |
| `adamantium_code_search` | Find a code symbol, a file's symbols, or a symbol's callers and callees, with `file:line`. Needs a project scanned into Adamanteum. |
| `adamantium_status`, `adamantium_receipts` | Who the key belongs to, what it may do, the audit trail. |
| `adamantium_write_note` | Create or replace a note. Needs a write key and the sha256 you read (`null` to create). A stale sha256 is refused; nothing is overwritten blind. |
| `adamantium_record_decision` | Append a timed line to the day's decision file. Write key. |

Every result carries provenance: path, line, sha256. Vault text comes back labelled as evidence, never as instructions. When Adamanteum is not running, the key is wrong, or the key is read-only, the AI gets a plain sentence saying so, not an empty answer.

## Fallback: an AI that cannot speak MCP

Anything that can make a web call can use the same door directly with a Bearer key. Same keys, same limits, same receipts.

```
GET  {url}/api/door/v1/            the list of routes
GET  {url}/api/door/v1/navigate?q=what did we decide about refunds
GET  {url}/api/door/v1/search?q=refund&limit=20
GET  {url}/api/door/v1/note?path=Decisions/Refunds.md
POST {url}/api/door/v1/note        {"path","body","expectedHash"}   (write key)
Authorization: Bearer adm1.<id>.<secret>
```
`curl -H "Authorization: Bearer $(cat door.token)" "http://127.0.0.1:4173/api/door/v1/navigate?q=refunds"`.
Send `expectedHash` (the sha256 you read, or `null` to create) with every write. Browsers cannot call the door; it takes keys from programs only.

## Measured: does `adamantium_navigate` beat search?
`verify/navigation-eval.mjs` asks the same 24 plain-words questions of the same 5,512-note vault three ways and counts where the right note lands (`verify/navigation-eval.json`). Results are in the release record; run it yourself against your vault with your own questions.
