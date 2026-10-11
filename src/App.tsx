import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type DocumentRow = {
  id: number;
  filename: string;
  chunk_count: number;
  collection_id: number | null;
};

type CollectionRow = {
  id: number;
  name: string;
  parent_id: number | null;
  document_count: number;
};

type SearchResult = {
  document_id: number;
  filename: string;
  chunk_id: number;
  chunk_index: number;
  text: string;
  score: number;
};

type AppStatus = {
  mcp_url: string;
  document_count: number;
  chunk_count: number;
  compatibility_mode: boolean;
};

type ImportResult = {
  document_id: number;
  filename: string;
  chunks_added: number;
};

type ActivityEvent = {
  id: number;
  timestamp_ms: number;
  tool: string;
  detail: string;
  result: string;
};

type TunnelConnection = {
  url: string;
  token: string;
};

type FolderImportResult = {
  discovered: number;
  imported: number;
  failed: number;
  embeddings_added: number;
  errors: string[];
};

type CollectionSelection = "all" | "unfiled" | number;

type FlatCollection = {
  collection: CollectionRow;
  depth: number;
};

function flattenCollections(
  collections: CollectionRow[],
  parentId: number | null = null,
  depth = 0,
): FlatCollection[] {
  return collections
    .filter((collection) => collection.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((collection) => [
      { collection, depth },
      ...flattenCollections(collections, collection.id, depth + 1),
    ]);
}

function collectionTreeIds(
  collections: CollectionRow[],
  rootId: number,
): Set<number> {
  const ids = new Set<number>([rootId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const collection of collections) {
      if (
        collection.parent_id !== null &&
        ids.has(collection.parent_id) &&
        !ids.has(collection.id)
      ) {
        ids.add(collection.id);
        changed = true;
      }
    }
  }

  return ids;
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [selectedCollection, setSelectedCollection] =
    useState<CollectionSelection>("all");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [compatibilityMode, setCompatibilityMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Ready");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [embeddingStatus, setEmbeddingStatus] = useState("");

  const endpoint = useMemo(
    () =>
      tunnelUrl
        ? `${tunnelUrl}/mcp`
        : status?.mcp_url ?? "http://127.0.0.1:8765/mcp",
    [status, tunnelUrl],
  );

  const flatCollections = useMemo(
    () => flattenCollections(collections),
    [collections],
  );

  const visibleDocuments = useMemo(() => {
    if (selectedCollection === "all") return documents;

    if (selectedCollection === "unfiled") {
      return documents.filter((document) => document.collection_id === null);
    }

    const ids = collectionTreeIds(collections, selectedCollection);

    return documents.filter(
      (document) =>
        document.collection_id !== null &&
        ids.has(document.collection_id),
    );
  }, [documents, collections, selectedCollection]);

  const selectedCollectionName = useMemo(() => {
    if (selectedCollection === "all") return "All Documents";
    if (selectedCollection === "unfiled") return "Unfiled";

    return (
      collections.find((collection) => collection.id === selectedCollection)
        ?.name ?? "Folder"
    );
  }, [collections, selectedCollection]);

  const unfiledCount = useMemo(
    () => documents.filter((document) => document.collection_id === null).length,
    [documents],
  );

  function collectionDisplayCount(collectionId: number) {
    const ids = collectionTreeIds(collections, collectionId);

    return documents.filter(
      (document) =>
        document.collection_id !== null && ids.has(document.collection_id),
    ).length;
  }

  async function refresh() {
    const [nextStatus, nextDocs, nextCollections] = await Promise.all([
      invoke<AppStatus>("get_status"),
      invoke<DocumentRow[]>("list_documents"),
      invoke<CollectionRow[]>("list_collections"),
    ]);

    setStatus(nextStatus);
    setDocuments(nextDocs);
    setCollections(nextCollections);
    setCompatibilityMode(nextStatus.compatibility_mode);
  }

  async function refreshActivity() {
    try {
      const events = await invoke<ActivityEvent[]>("get_activity");
      setActivity(events);
    } catch (error) {
      console.error("Could not load MCP activity", error);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    refreshActivity();

    const timer = window.setInterval(() => {
      refreshActivity();
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  async function createCollection() {
    const parentId =
      typeof selectedCollection === "number" ? selectedCollection : null;

    const name = window.prompt(
      parentId
        ? `New folder inside "${selectedCollectionName}"`
        : "New PaperLink folder",
    );

    if (!name?.trim()) return;

    try {
      setBusy("create-collection");

      const collectionId = await invoke<number>("create_collection", {
        name: name.trim(),
        parentId,
      });

      await refresh();
      setSelectedCollection(collectionId);
      setMessage(`Created folder "${name.trim()}"`);
    } catch (error) {
      setMessage(`Could not create folder: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteSelectedCollection() {
    if (typeof selectedCollection !== "number") return;

    const collection = collections.find(
      (item) => item.id === selectedCollection,
    );

    if (!collection) return;

    const confirmed = window.confirm(
      `Delete the PaperLink folder "${collection.name}"?\n\nThe PDFs on your computer will not be deleted.`,
    );

    if (!confirmed) return;

    try {
      setBusy("delete-collection");

      await invoke("delete_collection", {
        collectionId: collection.id,
      });

      setSelectedCollection("all");
      await refresh();
      setMessage(`Deleted folder "${collection.name}"`);
    } catch (error) {
      setMessage(`Could not delete folder: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function moveDocument(
    documentId: number,
    collectionId: number | null,
  ) {
    try {
      setBusy(`move-${documentId}`);

      await invoke("move_document", {
        documentId,
        collectionId,
      });

      await refresh();
      setMessage(
        collectionId === null
          ? "Moved document to Unfiled"
          : "Moved document to folder",
      );
    } catch (error) {
      setMessage(`Move failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function buildEmbeddings() {
    try {
      setBusy("embeddings");
      setEmbeddingStatus("Rebuilding semantic index...");

      const count = await invoke<number>("build_embeddings");

      setEmbeddingStatus(
        count === 0
          ? "Semantic index is already up to date."
          : `Generated ${count} embeddings.`,
      );
    } catch (error) {
      setEmbeddingStatus(`Embedding error: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function addPdf() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    });

    if (!selected || Array.isArray(selected)) return;

    try {
      setBusy("import");
      setMessage("Extracting, chunking and building semantic index...");

      const result = await invoke<ImportResult>("import_pdf", {
        path: selected,
      });

      if (typeof selectedCollection === "number") {
        await invoke("move_document", {
          documentId: result.document_id,
          collectionId: selectedCollection,
        });
      }

      setMessage(
        `Indexed ${result.filename} (${result.chunks_added} chunks) — semantic search ready`,
      );

      await refresh();
    } catch (error) {
      setMessage(`Import failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function addFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (!selected || Array.isArray(selected)) return;

    try {
      setBusy("folder");
      setMessage("Scanning folder, indexing PDFs and generating embeddings...");

      const result = await invoke<FolderImportResult>("import_folder", {
        path: selected,
      });

      setMessage(
        `Imported ${result.imported}/${result.discovered} PDFs, generated ${result.embeddings_added} embeddings${
          result.failed > 0 ? `, ${result.failed} failed` : ""
        }`,
      );

      if (result.failed > 0) {
        console.warn("Some PDFs failed:", result.errors);
      }

      await refresh();
    } catch (error) {
      setMessage(`Folder import failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function reindexDocument(documentId: number) {
    try {
      setBusy(`reindex-${documentId}`);

      const result = await invoke<ImportResult>("reindex_document", {
        documentId,
      });

      setMessage(
        `Reindexed ${result.filename} (${result.chunks_added} chunks)`,
      );

      await refresh();
    } catch (error) {
      setMessage(`Reindex failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteDocument(documentId: number, filename: string) {
    const confirmed = window.confirm(
      `Remove "${filename}" from PaperLink?\n\nThe original PDF will not be deleted from your computer.`,
    );

    if (!confirmed) return;

    try {
      setBusy(`delete-${documentId}`);

      await invoke("delete_document", {
        documentId,
      });

      setResults((current) =>
        current.filter((result) => result.document_id !== documentId),
      );

      setMessage(`Removed ${filename} from PaperLink`);
      await refresh();
    } catch (error) {
      setMessage(`Delete failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    if (!query.trim()) return;

    try {
      setBusy("search");

      const found = await invoke<SearchResult[]>("search_hybrid", {
        query,
        limit: 8,
      });

      setResults(found);
      setMessage(`${found.length} result${found.length === 1 ? "" : "s"}`);
    } catch (error) {
      setMessage(`Search failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function startTunnel() {
    try {
      setBusy("tunnel");
      setMessage("Starting temporary HTTPS tunnel...");

      const connection = await invoke<TunnelConnection>("start_tunnel");

      setTunnelUrl(connection.url);
      setAccessToken(connection.token);
      setCompatibilityMode(false);
      setMessage("Temporary internet access is online — bearer authentication enabled");
    } catch (error) {
      setMessage(`Tunnel failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function stopTunnel() {
    try {
      setBusy("tunnel-stop");

      await invoke("stop_tunnel");

      setTunnelUrl(null);
      setAccessToken(null);
      setCompatibilityMode(false);
      setMessage("Temporary internet access stopped");
    } catch (error) {
      setMessage(`Could not stop tunnel: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function setClaudeCompatibility(enabled: boolean) {
    try {
      setBusy("compatibility");

      await invoke("set_compatibility_mode", {
        enabled,
      });

      setCompatibilityMode(enabled);

      setMessage(
        enabled
          ? "Claude compatibility mode enabled — the temporary MCP URL no longer requires a token"
          : "Claude compatibility mode disabled — bearer authentication restored",
      );
    } catch (error) {
      setMessage(`Could not change compatibility mode: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint);
    setMessage("MCP endpoint copied");
  }

  async function copyToken() {
    if (!accessToken) return;
    await navigator.clipboard.writeText(accessToken);
    setMessage("Access token copied");
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">LOCAL-FIRST KNOWLEDGE</div>
          <h1>PaperLink</h1>
          <p>
            Organize, search and securely expose your local documents through MCP.
          </p>
        </div>

        <div className="status-pill">
          <span className="dot" /> MCP running
        </div>
      </header>

      <section className="top-grid">
        <article className="card metric">
          <span>Documents</span>
          <strong>{status?.document_count ?? 0}</strong>
        </article>

        <article className="card metric">
          <span>Indexed chunks</span>
          <strong>{status?.chunk_count ?? 0}</strong>
        </article>

        <article className="card connection-strip">
          <div>
            <span className="section-label">MCP endpoint</span>
            <code>{endpoint}</code>
          </div>

          <div className="connection-strip-actions">
            <button className="ghost" onClick={copyEndpoint}>
              Copy endpoint
            </button>

            {!tunnelUrl ? (
              <button onClick={startTunnel} disabled={busy === "tunnel"}>
                {busy === "tunnel" ? "Connecting..." : "Enable internet access"}
              </button>
            ) : (
              <button
                className="danger"
                onClick={stopTunnel}
                disabled={busy === "tunnel-stop"}
              >
                {busy === "tunnel-stop" ? "Stopping..." : "Stop tunnel"}
              </button>
            )}
          </div>

          {tunnelUrl && (
            <div
              className={`compatibility-box ${
                compatibilityMode ? "enabled" : ""
              }`}
            >
              <label className="compatibility-switch">
                <input
                  type="checkbox"
                  checked={compatibilityMode}
                  disabled={busy === "compatibility"}
                  onChange={(event) =>
                    setClaudeCompatibility(event.target.checked)
                  }
                />
                <span>Claude compatibility mode</span>
              </label>

              <span className="compatibility-description">
                {compatibilityMode
                  ? "No bearer token is required. Anyone who has the temporary tunnel URL can call your MCP tools."
                  : "Bearer authentication is required. Enable this only if Claude does not let you add a request header."}
              </span>
            </div>
          )}

          {accessToken && !compatibilityMode && (
            <div className="token-line">
              <span>Token</span>
              <code>{accessToken.slice(0, 8)}••••••••••••••••</code>
              <button className="ghost compact" onClick={copyToken}>
                Copy
              </button>
            </div>
          )}
        </article>
      </section>

      <section className="card library-card">
        <div className="library-header">
          <div>
            <h2>Knowledge library</h2>
            <p>Organize PDFs into local PaperLink folders.</p>
          </div>

          <div className="library-actions">
            <button
              className="ghost"
              onClick={createCollection}
              disabled={busy === "create-collection"}
            >
              + New Folder
            </button>

            <button
              className="ghost"
              onClick={addFolder}
              disabled={busy === "folder"}
            >
              {busy === "folder" ? "Importing..." : "Import Folder"}
            </button>

            <button onClick={addPdf} disabled={busy === "import"}>
              {busy === "import" ? "Indexing..." : "+ Add PDF"}
            </button>
          </div>
        </div>

        <div className="library-layout">
          <aside className="folder-panel">
            <div className="folder-panel-title">Library</div>

            <button
              className={`folder-row ${selectedCollection === "all" ? "active" : ""}`}
              onClick={() => setSelectedCollection("all")}
            >
              <span className="folder-row-label">▣ All Documents</span>
              <span className="folder-count">{documents.length}</span>
            </button>

            <button
              className={`folder-row ${selectedCollection === "unfiled" ? "active" : ""}`}
              onClick={() => setSelectedCollection("unfiled")}
            >
              <span className="folder-row-label">▤ Unfiled</span>
              <span className="folder-count">{unfiledCount}</span>
            </button>

            <div className="folder-separator" />
            <div className="folder-panel-title">Folders</div>

            {flatCollections.length === 0 ? (
              <div className="folder-empty">No folders yet</div>
            ) : (
              flatCollections.map(({ collection, depth }) => (
                <button
                  key={collection.id}
                  className={`folder-row ${selectedCollection === collection.id ? "active" : ""}`}
                  style={{ paddingLeft: `${12 + depth * 18}px` }}
                  onClick={() => setSelectedCollection(collection.id)}
                >
                  <span className="folder-row-label">▸ {collection.name}</span>
                  <span className="folder-count">
                    {collectionDisplayCount(collection.id)}
                  </span>
                </button>
              ))
            )}
          </aside>

          <div className="document-panel">
            <div className="document-panel-header">
              <div>
                <h3>{selectedCollectionName}</h3>
                <span>
                  {visibleDocuments.length} document
                  {visibleDocuments.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="document-panel-actions">
                {typeof selectedCollection === "number" && (
                  <>
                    <button
                      className="ghost compact"
                      onClick={createCollection}
                    >
                      + Subfolder
                    </button>

                    <button
                      className="ghost compact danger-text"
                      onClick={deleteSelectedCollection}
                    >
                      Delete folder
                    </button>
                  </>
                )}

                <details className="maintenance-menu">
                  <summary>•••</summary>
                  <button onClick={buildEmbeddings}>
                    Rebuild semantic index
                  </button>
                </details>
              </div>
            </div>

            {embeddingStatus && (
              <div className="inline-status">{embeddingStatus}</div>
            )}

            <div className="document-list">
              {visibleDocuments.length === 0 && (
                <div className="empty-state">
                  <strong>No documents here</strong>
                  <span>
                    Add a PDF, import a folder, or move an existing document here.
                  </span>
                </div>
              )}

              {visibleDocuments.map((doc) => {
                const reindexing = busy === `reindex-${doc.id}`;
                const deleting = busy === `delete-${doc.id}`;
                const moving = busy === `move-${doc.id}`;

                return (
                  <div className="document-row" key={doc.id}>
                    <div className="pdf-badge">PDF</div>

                    <div className="document-info">
                      <strong title={doc.filename}>{doc.filename}</strong>
                      <span>{doc.chunk_count} chunks</span>
                    </div>

                    <div className="document-actions">
                      <select
                        className="folder-select"
                        value={doc.collection_id ?? ""}
                        disabled={moving || reindexing || deleting}
                        onChange={(event) => {
                          const value = event.target.value;
                          moveDocument(
                            doc.id,
                            value === "" ? null : Number(value),
                          );
                        }}
                      >
                        <option value="">Unfiled</option>
                        {flatCollections.map(({ collection, depth }) => (
                          <option key={collection.id} value={collection.id}>
                            {`${"— ".repeat(depth)}${collection.name}`}
                          </option>
                        ))}
                      </select>

                      <button
                        className="ghost compact"
                        onClick={() => reindexDocument(doc.id)}
                        disabled={reindexing || deleting || moving}
                      >
                        {reindexing ? "Reindexing..." : "Reindex"}
                      </button>

                      <button
                        className="icon-button danger-text"
                        title="Delete from PaperLink"
                        onClick={() => deleteDocument(doc.id, doc.filename)}
                        disabled={reindexing || deleting || moving}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Test retrieval</h2>
              <p>Hybrid keyword + semantic search.</p>
            </div>
          </div>

          <div className="search-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") search();
              }}
              placeholder="Search your papers..."
            />

            <button onClick={search} disabled={busy === "search"}>
              {busy === "search" ? "Searching..." : "Search"}
            </button>
          </div>

          <div className="results">
            {results.map((result) => (
              <article className="result" key={result.chunk_id}>
                <div className="result-meta">
                  <strong>{result.filename}</strong>
                  <span>chunk {result.chunk_index + 1}</span>
                </div>
                <p>{result.text}</p>
              </article>
            ))}
          </div>
        </article>

        <article className="card activity-card">
          <div className="card-head">
            <div>
              <h2>Recent MCP activity</h2>
              <p>Requests received from connected AI clients.</p>
            </div>
            <div className="live-badge">
              <span className="dot" /> Live
            </div>
          </div>

          <div className="activity-list">
            {activity.length === 0 && (
              <div className="empty-state compact-empty">
                No MCP tool calls yet.
              </div>
            )}

            {activity.map((event) => (
              <div className="activity-item" key={event.id}>
                <time>
                  {new Date(event.timestamp_ms).toLocaleTimeString()}
                </time>
                <div className="activity-copy">
                  <strong>{event.tool}</strong>
                  {event.detail && <code>{event.detail}</code>}
                  <span>{event.result}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <footer>{message}</footer>
    </main>
  );
}
