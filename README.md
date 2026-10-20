# PaperLink
Built solo for the Grevix AfterCode 2026 hackathon

**PaperLink is a local-first desktop MCP knowledge library for PDFs.**

Import PDFs, organize them into folders, search them with hybrid keyword + semantic retrieval, and expose only relevant context to MCP-compatible AI clients.

[https://media.giphy.com/media/vFKqnCdLPNOKc/giphy.gif](https://github.com/user-attachments/assets/05eec253-acf2-4a7a-9cc8-cad3571998a8)


## Features

- Local PDF import and text extraction
- Question-aware chunking for past papers
- SQLite + FTS5 keyword search
- Local embeddings with FastEmbed
- Hybrid keyword + semantic retrieval
- Virtual folders / collections
- Reindex and delete document controls
- Local MCP server
- Temporary HTTPS access with Cloudflare Quick Tunnels
- Bearer-token protection
- Claude compatibility mode for connector UIs that cannot send custom authorization headers
- Local activity log for MCP tool calls

## Install on Windows

### 1. Install PaperLink

Download the latest Windows installer from the **Releases** page.

Recommended:

- `PaperLink_*_x64-setup.exe`

You can also use the MSI package if provided.

Run the installer and launch PaperLink.

### 2. Install Cloudflare Tunnel

PaperLink uses `cloudflared` to create a temporary public HTTPS URL when a browser-based AI client needs to reach your local MCP server.

Install `cloudflared` with Windows Package Manager:

```powershell
winget install --id Cloudflare.cloudflared -e
```

Verify the installation:

```powershell
cloudflared --version
```

If `cloudflared` is not found, restart your terminal or Windows session after installation.

You can also install it manually from Cloudflare's official downloads page:

https://developers.cloudflare.com/tunnel/downloads/

> PaperLink uses Cloudflare **Quick Tunnels** for temporary access. Quick Tunnels are intended for development/testing and produce a temporary `trycloudflare.com` URL.

## Using PaperLink

### Import documents

Open PaperLink and use:

- **+ Add PDF** to import one PDF
- **Import Folder** to recursively import PDFs from a folder
- **+ New Folder** to create a virtual PaperLink collection

PaperLink automatically:

1. extracts PDF text
2. detects question boundaries where possible
3. chunks the document
4. stores content in local SQLite
5. generates embeddings locally
6. makes the document available to hybrid search and MCP

### Local retrieval

Use **Test retrieval** inside PaperLink to search your indexed documents.

Search combines:

- SQLite FTS5 keyword retrieval
- local semantic embeddings
- Reciprocal Rank Fusion

## Connect an AI client

PaperLink runs a local MCP endpoint at:

```text
http://127.0.0.1:8765/mcp
```

For a browser-based AI client, click:

```text
Enable internet access
```

PaperLink starts a Cloudflare Quick Tunnel and displays a temporary HTTPS MCP endpoint.

Example:

```text
https://example-random-name.trycloudflare.com/mcp
```

### Secure bearer-token mode

By default, a public PaperLink tunnel requires:

```http
Authorization: Bearer <PaperLink token>
```

Use this mode with MCP clients that support custom request headers.

### Claude compatibility mode

Some Claude connector screens may not provide a way to send a custom `Authorization` request header.

In that case:

1. Start **Enable internet access** in PaperLink.
2. Turn on **Claude compatibility mode**.
3. Copy the public MCP endpoint.
4. In Claude, add a custom connector.
5. Choose **No sign-in**.
6. Use **Streamable HTTP**.
7. Paste the PaperLink MCP URL.

> **Security warning:** Claude compatibility mode disables bearer-token checking for the active temporary tunnel. Anyone who obtains the temporary tunnel URL can call the exposed MCP tools while the mode is enabled. Turn it off when you are finished, or stop the tunnel.

Stopping the tunnel automatically disables compatibility mode.

## MCP tools

PaperLink currently exposes:

```text
list_collections
list_documents
list_collection_documents
search_documents
read_document
```

The MCP server understands PaperLink folder structure. AI clients can list collections, inspect documents inside a collection, and search within a specific collection and its subfolders.

## Privacy model

PaperLink is local-first:

- PDFs remain on your computer.
- SQLite data remains on your computer.
- Embeddings are generated locally.
- Search runs locally.
- There is no central PaperLink document database.

When an AI client calls an MCP tool, the relevant retrieved text returned by that tool is sent to that AI client/provider.

## Build from source

### Requirements

Install:

- Node.js
- Rust
- Microsoft Visual Studio Build Tools with the C++ desktop workload
- `cloudflared`

Then:

```powershell
git clone https://github.com/Mwick01/PaperLink.git
cd PaperLink
npm install
npm run tauri dev
```

### Production build

Before building, make sure the app version is set to the release version in the relevant project files, such as:

```text
package.json
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```

Then build:

```powershell
npm run tauri build
```

Tauri release artifacts are typically written under:

```text
src-tauri/target/release/bundle/
```

On Windows, look for installer files under directories such as:

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

## Development notes

Cloudflare Quick Tunnel URLs change when the tunnel restarts.

Scanned PDFs without extractable text currently require OCR support, which is not yet included.

PaperLink is under active development.
