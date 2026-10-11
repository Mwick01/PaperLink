# PaperLink v0.3.0

PaperLink v0.3.0 is the first submission-ready desktop release of the local-first PDF MCP workflow.

## Highlights

- Question-aware PDF chunking for past papers
- Automatic local embedding generation on import
- Hybrid SQLite FTS5 + semantic retrieval
- Reciprocal Rank Fusion ranking
- Virtual folders / collections with nested folder support
- Import individual PDFs or recursively import a folder
- Reindex and remove documents without deleting the original PDF
- Folder-aware MCP tools
- Temporary public HTTPS access with Cloudflare Quick Tunnels
- Bearer-token authentication for public MCP access
- Claude compatibility mode for connector UIs that cannot send custom headers
- MCP activity tracking

## MCP tools

- `list_collections`
- `list_documents`
- `list_collection_documents`
- `search_documents`
- `read_document`

## Windows installation

1. Download and install the PaperLink Windows installer attached to this release.
2. Install Cloudflare Tunnel:

```powershell
winget install --id Cloudflare.cloudflared -e
```

3. Verify:

```powershell
cloudflared --version
```

4. Launch PaperLink and import your PDFs.

## Claude

For Claude connector UIs that do not expose a custom Authorization header:

1. Start PaperLink internet access.
2. Enable **Claude compatibility mode**.
3. Add the generated `https://*.trycloudflare.com/mcp` endpoint to Claude.
4. Select **No sign-in** and **Streamable HTTP**.

Compatibility mode removes bearer authentication for that temporary tunnel, so only enable it while needed.

## Known limitations

- Cloudflare Quick Tunnel URLs are temporary and change after restart.
- Quick Tunnels are intended for development/testing.
- Scanned/image-only PDFs are not supported yet because OCR is not included.
- Compatibility mode trades authentication for connector compatibility.
- Windows is the primary tested platform for this release.
