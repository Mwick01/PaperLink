# PaperLink — Claude Compatibility Mode

This package adds an explicit compatibility toggle for Claude custom connectors that
do not expose arbitrary request headers.

## Replace these files

- `src-tauri/src/auth.rs`
- `src-tauri/src/mcp/mod.rs`
- `src-tauri/src/lib.rs`
- `src/App.tsx`

Append `src/compatibility-mode.css` to your existing `src/styles.css`.

## Behaviour

### Default / secure mode
Every new Cloudflare tunnel starts with bearer authentication enabled.

Requests must include:

`Authorization: Bearer <PaperLink token>`

### Claude compatibility mode
When the toggle is enabled, the active temporary tunnel accepts MCP requests
without a bearer token.

Use this only when the Claude connector UI does not let you provide an
Authorization header.

Anyone who obtains the temporary `trycloudflare.com` URL can call the MCP tools
while compatibility mode is enabled.

Stopping the tunnel automatically turns compatibility mode off.

## Claude setup

1. Start temporary internet access in PaperLink.
2. Enable **Claude compatibility mode**.
3. In Claude, add the PaperLink `/mcp` URL.
4. Choose **No sign-in**.
5. Keep transport as **Streamable HTTP**.
6. Add the connector.

## Test before Claude

With compatibility mode OFF:

`npx @modelcontextprotocol/inspector --cli https://YOUR-URL/mcp --transport http --method tools/list`

Expected: HTTP 401.

With compatibility mode ON, run the same command.

Expected: PaperLink's MCP tools are returned.
