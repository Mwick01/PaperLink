# Grevix Local MCP — v0.1

A local-first desktop knowledge base that indexes PDF text into SQLite/FTS5 and exposes the retrieval layer through MCP.

## MVP architecture

```text
PDFs
  ↓
pdf-extract
  ↓
local SQLite + FTS5
  ├── desktop search UI
  └── MCP tools on http://127.0.0.1:8765/mcp
          ↓
optional cloudflared Quick Tunnel
          ↓
browser-based MCP client
```

### MCP tools

- `search_documents(query, limit?)`
- `list_documents()`
- `read_document(document_id, limit?)`

## Requirements

- Node.js 20+
- Rust stable toolchain
- Platform dependencies required by Tauri v2
- Optional: `cloudflared` on PATH for the **Start temporary tunnel** button

On Windows, install the Tauri prerequisites first (Microsoft C++ Build Tools + WebView2 where needed).

## Run

```bash
npm install
npm run tauri dev
```

The app creates its SQLite database inside the OS application-data directory and starts the MCP endpoint at:

```text
http://127.0.0.1:8765/mcp
```

## Test the local search

1. Start the app.
2. Click **Add PDF**.
3. Select a text-based PDF.
4. Search for a phrase in the bottom search box.
5. The same database/search function is available via `search_documents` over MCP.

Scanned/image-only PDFs are intentionally out of scope for v0.1; OCR comes later.

## Temporary browser-access tunnel

Install Cloudflare's `cloudflared` CLI, then press **Start temporary tunnel** in the app. Internally this runs:

```bash
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8765
```

The app captures the generated `https://....trycloudflare.com` URL and displays the full MCP endpoint.

> **Security note:** this v0.1 scaffold does not yet add bearer-token authentication to the tunnel endpoint. Use Quick Tunnel only with non-sensitive demo documents until the auth middleware milestone is completed.

## Next milestones

1. Compile/test on Windows and fix any platform-specific issues.
2. Add bearer-token authentication before using tunnels with private data.
3. Bundle `cloudflared` as a Tauri sidecar so users do not install it manually.
4. Add directory import and filesystem change detection.
5. Add page-aware PDF extraction.
6. Add local embeddings + vector search and combine them with FTS5 for hybrid retrieval.
7. Add a connection wizard for Claude/ChatGPT-compatible MCP clients.

## Dependency choices

- Tauri v2 for the desktop shell.
- `rusqlite` with bundled SQLite for predictable FTS5 behavior on Windows.
- `pdf-extract` for the initial text-only PDF pipeline.
- Official `modelcontextprotocol/rust-sdk` (`rmcp`) for Streamable HTTP MCP.
