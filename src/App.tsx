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
type AppView = "library" | "connect" | "activity";

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
  const [activeView, setActiveView] = useState<AppView>("library");

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
    if (selectedCollection === "all") return "All papers";
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
          ? "Moved paper to Unfiled"
          : "Moved paper to folder",
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
      setEmbeddingStatus("Refreshing the search index…");

      const count = await invoke<number>("build_embeddings");

      setEmbeddingStatus(
        count === 0
          ? "Search index is already up to date."
          : `Updated ${count} searchable sections.`,
      );
    } catch (error) {
      setEmbeddingStatus(`Could not refresh the search index: ${String(error)}`);
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
      setMessage("Adding your paper and preparing it for search…");

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
        `Added ${result.filename}. It is ready to search with AI.`,
      );

      await refresh();
    } catch (error) {
      setMessage(`Could not add this PDF: ${String(error)}`);
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
      setMessage("Adding PDFs from this folder and preparing them for search…");

      const result = await invoke<FolderImportResult>("import_folder", {
        path: selected,
      });

      setMessage(
        `Added ${result.imported} of ${result.discovered} PDFs${
          result.failed > 0 ? ` · ${result.failed} could not be added` : ""
        }.`,
      );

      if (result.failed > 0) {
        console.warn("Some PDFs failed:", result.errors);
      }

      await refresh();
    } catch (error) {
      setMessage(`Could not import this folder: ${String(error)}`);
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

      setMessage(`Refreshed ${result.filename} for search.`);
      await refresh();
    } catch (error) {
      setMessage(`Could not refresh this paper: ${String(error)}`);
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
      setMessage(`Could not remove this paper: ${String(error)}`);
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
      setMessage(`${found.length} search result${found.length === 1 ? "" : "s"}`);
    } catch (error) {
      setMessage(`Search failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function startTunnel() {
    try {
      setBusy("tunnel");
      setMessage("Creating a temporary secure internet connection…");

      const connection = await invoke<TunnelConnection>("start_tunnel");

      setTunnelUrl(connection.url);
      setAccessToken(connection.token);
      setCompatibilityMode(false);
      setMessage("Internet connection is ready. Password protection is on.");
    } catch (error) {
      setMessage(`Could not create the connection: ${String(error)}`);
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
      setMessage("Temporary internet connection stopped.");
    } catch (error) {
      setMessage(`Could not stop the connection: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function setClaudeCompatibility(enabled: boolean) {
    if (enabled) {
      const confirmed = window.confirm(
        "Allow this temporary connection without a password?\n\nAnyone who gets the temporary link could use your PaperLink tools until you turn this off or stop the connection.",
      );

      if (!confirmed) return;
    }

    try {
      setBusy("compatibility");

      await invoke("set_compatibility_mode", {
        enabled,
      });

      setCompatibilityMode(enabled);

      setMessage(
        enabled
          ? "Password protection is off for this temporary connection."
          : "Password protection is back on.",
      );
    } catch (error) {
      setMessage(`Could not change connection security: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint);
    setMessage("Connection address copied.");
  }

  async function copyToken() {
    if (!accessToken) return;
    await navigator.clipboard.writeText(accessToken);
    setMessage("Connection password copied.");
  }

  return (
    <main className="shell">
      <header className="app-header">
        <button
          className="brand"
          type="button"
          onClick={() => setActiveView("library")}
          aria-label="Open your PaperLink library"
        >
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>
            <strong>PaperLink</strong>
            <small>Your papers, ready for AI</small>
          </span>
        </button>

        <nav className="primary-nav" aria-label="Main navigation">
          <button
            className={activeView === "library" ? "active" : ""}
            onClick={() => setActiveView("library")}
          >
            Library
          </button>
          <button
            className={activeView === "connect" ? "active" : ""}
            onClick={() => setActiveView("connect")}
          >
            Connect AI
          </button>
          <button
            className={activeView === "activity" ? "active" : ""}
            onClick={() => setActiveView("activity")}
          >
            Activity
          </button>
        </nav>

        <div className="local-status" title="PaperLink runs on this computer">
          <span className="status-dot" />
          Local
        </div>
      </header>

      {message !== "Ready" && (
        <div className="app-message" role="status" aria-live="polite">
          {message}
        </div>
      )}

      {activeView === "library" && (
        <>
          <section className="page-intro library-intro">
            <div>
              <h1>Your papers</h1>
              <p>Keep past papers organized and ready to search with AI.</p>
              <div className="library-summary">
                <strong>{status?.document_count ?? 0}</strong> papers
                <span aria-hidden="true">·</span>
                <strong>{status?.chunk_count ?? 0}</strong> searchable sections
              </div>
            </div>

            <div className="page-actions">
              <button className="secondary" onClick={addFolder} disabled={busy === "folder"}>
                {busy === "folder" ? "Adding folder…" : "Import folder"}
              </button>
              <button onClick={addPdf} disabled={busy === "import"}>
                {busy === "import" ? "Adding paper…" : "Add PDF"}
              </button>
            </div>
          </section>

          {documents.length === 0 ? (
            <section className="first-run">
              <div className="first-run-copy">
                <h2>Add your first past paper</h2>
                <p>
                  PaperLink keeps your PDFs on this computer, then prepares them
                  so your AI assistant can find the right parts when you ask a question.
                </p>
              </div>
              <div className="first-run-actions">
                <button onClick={addPdf} disabled={busy === "import"}>
                  Add a PDF
                </button>
                <button className="secondary" onClick={addFolder} disabled={busy === "folder"}>
                  Import a folder
                </button>
              </div>
              <div className="privacy-note">
                Your library and search index stay on this computer.
              </div>
            </section>
          ) : (
            <section className="library">
              <aside className="folder-panel" aria-label="Paper folders">
                <div className="folder-panel-header">
                  <strong>My library</strong>
                  <button
                    className="text-button"
                    onClick={createCollection}
                    disabled={busy === "create-collection"}
                  >
                    New folder
                  </button>
                </div>

                <button
                  className={`folder-row ${selectedCollection === "all" ? "active" : ""}`}
                  onClick={() => setSelectedCollection("all")}
                >
                  <span>All papers</span>
                  <span className="folder-count">{documents.length}</span>
                </button>

                <button
                  className={`folder-row ${selectedCollection === "unfiled" ? "active" : ""}`}
                  onClick={() => setSelectedCollection("unfiled")}
                >
                  <span>Unfiled</span>
                  <span className="folder-count">{unfiledCount}</span>
                </button>

                <div className="folder-divider" />
                <div className="folder-section-label">Folders</div>

                {flatCollections.length === 0 ? (
                  <div className="folder-empty">No folders yet</div>
                ) : (
                  flatCollections.map(({ collection, depth }) => (
                    <button
                      key={collection.id}
                      className={`folder-row ${
                        selectedCollection === collection.id ? "active" : ""
                      }`}
                      style={{ paddingLeft: `${12 + depth * 16}px` }}
                      onClick={() => setSelectedCollection(collection.id)}
                    >
                      <span>{collection.name}</span>
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
                    <h2>{selectedCollectionName}</h2>
                    <p>
                      {visibleDocuments.length} paper
                      {visibleDocuments.length === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="folder-actions">
                    {typeof selectedCollection === "number" && (
                      <>
                        <button
                          className="secondary small"
                          onClick={createCollection}
                          disabled={busy === "create-collection"}
                        >
                          New subfolder
                        </button>
                        <details className="menu">
                          <summary>Folder options</summary>
                          <div className="menu-popover">
                            <button
                              className="menu-danger"
                              onClick={deleteSelectedCollection}
                              disabled={busy === "delete-collection"}
                            >
                              Delete folder
                            </button>
                          </div>
                        </details>
                      </>
                    )}

                    <details className="menu">
                      <summary>Library options</summary>
                      <div className="menu-popover">
                        <button
                          onClick={buildEmbeddings}
                          disabled={busy === "embeddings"}
                        >
                          Refresh search index
                        </button>
                      </div>
                    </details>
                  </div>
                </div>

                {embeddingStatus && (
                  <div className="inline-status" role="status">
                    {embeddingStatus}
                  </div>
                )}

                <div className="document-list">
                  {visibleDocuments.length === 0 && (
                    <div className="empty-state">
                      <strong>No papers in this folder</strong>
                      <span>Add a PDF or move an existing paper here.</span>
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
                          <span>Ready to search · {doc.chunk_count} sections</span>
                        </div>

                        <div className="document-actions">
                          <label className="move-control">
                            <span>Folder</span>
                            <select
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
                          </label>

                          <details className="menu row-menu">
                            <summary aria-label={`More actions for ${doc.filename}`}>
                              More
                            </summary>
                            <div className="menu-popover">
                              <button
                                onClick={() => reindexDocument(doc.id)}
                                disabled={reindexing || deleting || moving}
                              >
                                {reindexing ? "Refreshing…" : "Refresh for search"}
                              </button>
                              <button
                                className="menu-danger"
                                onClick={() => deleteDocument(doc.id, doc.filename)}
                                disabled={reindexing || deleting || moving}
                              >
                                Remove from PaperLink
                              </button>
                            </div>
                          </details>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {activeView === "connect" && (
        <>
          <section className="page-intro">
            <div>
              <h1>Connect your AI</h1>
              <p>
                Give ChatGPT, Claude, or another MCP client access to your PaperLink library.
              </p>
            </div>
          </section>

          <section className="connection-panel">
            <div className="connection-heading">
              <div>
                <h2>{tunnelUrl ? "Internet connection ready" : "Local connection ready"}</h2>
                <p>
                  {tunnelUrl
                    ? "Use the temporary address below with a browser-based AI client."
                    : "Apps running on this computer can connect directly."}
                </p>
              </div>
              <span className={`connection-badge ${tunnelUrl ? "online" : ""}`}>
                <span className="status-dot" />
                {tunnelUrl ? "Online" : "Local only"}
              </span>
            </div>

            <div className="endpoint-row">
              <div>
                <span className="field-label">Connection address</span>
                <code>{endpoint}</code>
              </div>
              <button className="secondary" onClick={copyEndpoint}>
                Copy address
              </button>
            </div>

            <div className="connection-actions">
              {!tunnelUrl ? (
                <button onClick={startTunnel} disabled={busy === "tunnel"}>
                  {busy === "tunnel" ? "Connecting…" : "Allow internet connection"}
                </button>
              ) : (
                <button
                  className="danger-button"
                  onClick={stopTunnel}
                  disabled={busy === "tunnel-stop"}
                >
                  {busy === "tunnel-stop" ? "Stopping…" : "Stop internet connection"}
                </button>
              )}
              <p>
                Only turn on internet access when your AI client needs a public HTTPS address.
              </p>
            </div>

            {tunnelUrl && (
              <div className={`security-panel ${compatibilityMode ? "warning" : ""}`}>
                <div>
                  <strong>
                    {compatibilityMode
                      ? "Password protection is off"
                      : "Password protection is on"}
                  </strong>
                  <p>
                    {compatibilityMode
                      ? "Anyone with the temporary link can call your PaperLink tools until you turn this off or stop the connection."
                      : "The temporary connection requires a password. Keep it on whenever your AI client supports authentication."}
                  </p>
                </div>

                <label className="security-toggle">
                  <input
                    type="checkbox"
                    checked={compatibilityMode}
                    disabled={busy === "compatibility"}
                    onChange={(event) =>
                      setClaudeCompatibility(event.target.checked)
                    }
                  />
                  <span>Allow connection without a password</span>
                </label>
              </div>
            )}

            <details className="technical-details">
              <summary>Technical details</summary>
              <div className="technical-content">
                <div>
                  <span className="field-label">MCP transport</span>
                  <span>Streamable HTTP</span>
                </div>
                <div>
                  <span className="field-label">Authentication</span>
                  <span>
                    {tunnelUrl
                      ? compatibilityMode
                        ? "None for the active temporary tunnel"
                        : "Bearer token"
                      : "Local connection"}
                  </span>
                </div>
                {accessToken && !compatibilityMode && (
                  <div className="token-row">
                    <div>
                      <span className="field-label">Connection password</span>
                      <code>{accessToken.slice(0, 8)}••••••••••••••••</code>
                    </div>
                    <button className="secondary small" onClick={copyToken}>
                      Copy password
                    </button>
                  </div>
                )}
                <p className="technical-note">
                  Some Claude connector screens cannot send an Authorization header.
                  Only use password-free mode when that limitation applies.
                </p>
              </div>
            </details>
          </section>
        </>
      )}

      {activeView === "activity" && (
        <>
          <section className="page-intro">
            <div>
              <h1>Activity</h1>
              <p>Test your library and see what connected AI clients are requesting.</p>
            </div>
          </section>

          <section className="activity-section">
            <div className="section-heading">
              <div>
                <h2>Search all papers</h2>
                <p>Check what PaperLink can find before you ask your AI assistant.</p>
              </div>
            </div>

            <div className="search-row">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") search();
                }}
                placeholder="Try a question or topic…"
                aria-label="Search all papers"
              />

              <button onClick={search} disabled={busy === "search"}>
                {busy === "search" ? "Searching…" : "Search"}
              </button>
            </div>

            <div className="results">
              {results.map((result) => (
                <article className="result" key={result.chunk_id}>
                  <div className="result-meta">
                    <strong>{result.filename}</strong>
                    <span>section {result.chunk_index + 1}</span>
                  </div>
                  <p>{result.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="activity-section">
            <div className="section-heading">
              <div>
                <h2>Recent AI activity</h2>
                <p>Requests received from connected AI clients.</p>
              </div>
              <span className="live-label">
                <span className="status-dot" />
                Live
              </span>
            </div>

            <div className="activity-list">
              {activity.length === 0 && (
                <div className="empty-state compact-empty">
                  <strong>No AI requests yet</strong>
                  <span>They will appear here when a connected client uses PaperLink.</span>
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
          </section>
        </>
      )}
    </main>
  );
}
