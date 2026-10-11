# PaperLink Known Issues

## v0.1.1

### Recent MCP activity does not update
The Recent MCP Activity panel is implemented, but remote MCP tool calls are
currently not appearing in the UI.

The MCP tools themselves continue to work correctly through Claude and MCP
Inspector.

Status: Known issue, deferred until core retrieval features are complete.

---

### Cloudflare Quick Tunnel URL changes

PaperLink currently uses Cloudflare Quick Tunnels.

A new `trycloudflare.com` URL is generated when the tunnel is restarted.

This means an MCP connector may need to be updated with the new URL after
PaperLink or the tunnel restarts.

---

### Tunnel authentication is not implemented yet

The temporary public MCP endpoint currently has no PaperLink-level access
token.

Do not use sensitive/private documents over the public tunnel yet.

Planned: generated bearer-token authentication.

---

### Search is keyword-based

Search currently uses SQLite FTS5.

Queries containing words present in the document work well, but semantic
queries may not retrieve relevant chunks if they use different terminology.

Planned for v0.2:

- Local embeddings
- Semantic search
- Hybrid FTS + vector ranking

---

### Scanned PDFs are not supported

PaperLink currently extracts text directly from PDFs.

Image-only/scanned PDFs may produce little or no searchable content.

Planned: optional local OCR support.

---

### MCP schema portability warnings

MCP Inspector currently reports:

`Schema portability: 0 errors, 2 warnings`

These warnings do not prevent the tools from functioning.

The schemas will be cleaned up in a later release.