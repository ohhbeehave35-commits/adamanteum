# Adamanteum

A fast, local knowledge atlas for your Markdown notes and your code. Point it at a folder of notes (an Obsidian vault works as is) and get search, links and backlinks, a graph, Bases, Canvas, daily notes, templates and a code map, all on your own computer.

- No account. No cloud. No AI model needed.
- Your notes stay ordinary `.md` files in your own folder.
- Any AI you choose can use your vault through one door, with a key you make and a receipt for every call.

MIT licensed.

## Download and run

You need [Node.js](https://nodejs.org) 24 or newer. Python 3 is optional (only for reading Python code).

```bash
git clone <this repository URL> adamanteum
cd adamanteum
npm install
npm start
```

Open http://127.0.0.1:4173. With no folder chosen it opens the small sample vault in `samples/vault`.

On Windows you can double-click `Launch Adamantium.cmd` instead: it installs what is needed and asks you to pick your notes folder.

## Point it at your own notes

```bash
# macOS / Linux
ADAMANTIUM_VAULT=/path/to/your/notes npm start

# Windows (PowerShell)
$env:ADAMANTIUM_VAULT="C:\path\to\your\notes"; npm start
```

It opens read-only. To let it save notes, add `ADAMANTIUM_VAULT_WRITE=1`. Back up the folder first.

| Setting | What it does | Default |
|---|---|---|
| `ADAMANTIUM_VAULT` | Your notes folder | the sample vault |
| `ADAMANTIUM_VAULT_WRITE` | `1` lets the app save notes | read-only |
| `ADAMANTIUM_DATA_DIR` | Where its index and settings live | `.data` beside the code |
| `ADAMANTIUM_LOG_DIR` | Folder for decision and results files written through the door | `Log` |
| `PORT` | Local port | `4173` |

## Coming from Obsidian

Nothing to convert: point `ADAMANTIUM_VAULT` at your Obsidian vault. Links, embeds, tags, properties, Bases, Canvas, daily notes, templates and bookmarks are read as Obsidian writes them, and folders Obsidian excludes stay excluded.

To bring Obsidian's own settings across (bookmarks and similar):

```bash
node adamantium-cli.mjs import-obsidian /path/to/your/vault --dry-run   # shows the report, writes nothing
node adamantium-cli.mjs import-obsidian /path/to/your/vault
```

## What it does

| Area | What you get |
|---|---|
| Notes | Open, search and edit Markdown with properties, tags, links, backlinks and embeds. |
| Search | `tag:`, `path:`, `file:`, `"phrase"`, `-word`, `OR`; file names first, like a quick switcher. |
| Graph | Whole-vault and local graph, with communities that have readable names. |
| Bases and Canvas | Obsidian `.base` and `.canvas` files, viewed and edited. |
| Code map | JavaScript, TypeScript, Python and 28 more languages: symbols, calls with file and line, and where each call resolves. |
| Graphify | Imports a Graphify `graph.json` and keeps its communities; exports notes, GraphML, Mermaid and more. |
| Code and notes together | A note lists the code it mentions; a code file lists the notes that mention it. |
| Reports | Broken links, orphans, duplicate names, what changed since a date. |

## Measured against Obsidian

Measured on a copy of a 96,605-note working vault, with Obsidian 1.14 on the original.

| Area | Result | Measurement |
|---|---|---|
| Notes opened | Equal | 96,578 of Obsidian's 96,596; the other 18 were written after the copy was taken. |
| Links and backlinks | Equal | 30 of 31 sampled notes identical; the one difference is inside a folder Obsidian excludes. |
| Graph, search operators, daily notes, properties, templates, bookmarks, Bases, Canvas | Equal | Same results on every check. |
| Tags | Not equal yet | 382 of 3,671 tags have the exact same count and 793 are within 2%; work continues. |
| Search speed | Faster | 16.5 ms per page of results, against 8.3 s for Obsidian's command line, warm. |
| Start to first search | 0.77 s | Cold start on the same vault. |
| Code map against Graphify | 85% of call edges | Python 85.6%, JavaScript 63%; 99.9% of declarations. |

## Let an AI use your vault

Make a key for the AI, then give it the address and the key:

```bash
node adamantium-cli.mjs door mint my-ai --scope read --out my-ai.token
```

Any AI that speaks MCP can then search, read and follow links in your vault (and write, with a `write` key) through `mcp-server.mjs`. `MCP.md` has the block to paste into Claude Desktop, Cursor, Codex, Grok or another MCP app. Every call is logged as a receipt you can read in the app.

## Tests

```bash
npm test
```

Runs the full suite with no vault and no AI model.

## Not built yet

- Edge colours and labels in the canvas editor (the viewer shows them).
- Obsidian community plugins, mobile apps, Sync and Publish.
- A live-preview editor (the notebook is a Markdown box with a reading preview).
- Tested mainly on Windows.

## Licence

MIT. See `LICENSE` and `NOTICE`.
