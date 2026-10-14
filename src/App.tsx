import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import TitleBar from "./TitleBar";

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
type NoticeTone = "info" | "success" | "warning" | "error";

function friendlyError(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const normalized = detail.toLowerCase();

  if (normalized.includes("permission") || normalized.includes("denied")) {
    return `${fallback} Check that PaperLink has permission to access the file or folder, then try again.`;
  }

  if (normalized.includes("cloudflared") || normalized.includes("cloudflare")) {
    return `${fallback} Check that Cloudflare Tunnel is installed and available, then try again.`;
  }

  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return `${fallback} The operation took too long. Try again.`;
  }

  if (normalized.includes("network") || normalized.includes("connection")) {
    return `${fallback} Check your connection and try again.`;
  }

  return fallback;
}

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
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderParentId, setFolderParentId] = useState<number | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [compatibilityMode, setCompatibilityMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Ready");
  const [messageTone, setMessageTone] = useState<NoticeTone>("info");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState("");

  const isWorking = busy !== null;

  function announce(text: string, tone: NoticeTone = "info") {
    setMessage(text);
    setMessageTone(tone);
  }

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

  const folderParentName = useMemo(
    () =>
      folderParentId === null
        ? null
        : collections.find((collection) => collection.id === folderParentId)?.name ??
          "folder",
    [collections, folderParentId],
  );

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

  async function refreshAfterChange(
    successMessage: string,
    successTone: NoticeTone = "success",
  ) {
    try {
      await refresh();
      announce(successMessage, successTone);
    } catch (error) {
      console.error("Change saved but library refresh failed", error);
      announce(
        "Your change was saved, but PaperLink could not refresh the library. Try switching views or restart PaperLink.",
        "warning",
      );
    }
  }

  async function loadInitialData() {
    setInitialLoading(true);
    setLoadError(null);

    try {
      await refresh();
      setMessage("Ready");
      setMessageTone("info");
    } catch (error) {
      console.error("Could not load PaperLink library", error);
      const recovery = friendlyError(
        error,
        "PaperLink could not load your library.",
      );
      setLoadError(recovery);
      announce(recovery, "error");
    } finally {
      setInitialLoading(false);
    }
  }

  async function refreshActivity() {
    try {
      const events = await invoke<ActivityEvent[]>("get_activity");
      setActivity(events);
      setActivityError(null);
    } catch (error) {
      console.error("Could not load AI activity", error);
      setActivityError(
        friendlyError(error, "PaperLink could not refresh AI activity."),
      );
    }
  }

  useEffect(() => {
    if (folderFormOpen) folderInputRef.current?.focus();
  }, [folderFormOpen]);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (activeView !== "activity") return;

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      await refreshActivity();
      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), 1500);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeView]);

  function openCollectionCreator(parentId: number | null) {
    if (isWorking) return;
    setFolderParentId(parentId);
    setFolderDraft("");
    setFolderFormOpen(true);
  }

  function closeCollectionCreator() {
    setFolderFormOpen(false);
    setFolderDraft("");
    setFolderParentId(null);
  }

  async function createCollection() {
    if (isWorking) return;

    const trimmedName = folderDraft.trim();
    if (!trimmedName) {
      announce("Enter a folder name.", "error");
      folderInputRef.current?.focus();
      return;
    }

    if (trimmedName.length > 120) {
      announce("Folder names can be up to 120 characters.", "error");
      folderInputRef.current?.focus();
      return;
    }

    try {
      setBusy("create-collection");

      const collectionId = await invoke<number>("create_collection", {
        name: trimmedName,
        parentId: folderParentId,
      });

      setSelectedCollection(collectionId);
      closeCollectionCreator();
      await refreshAfterChange(`Created folder "${trimmedName}".`);
    } catch (error) {
      console.error("Could not create folder", error);
      announce(friendlyError(error, "Could not create this folder."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function deleteSelectedCollection() {
    if (isWorking) return;
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
      if (folderParentId === collection.id) closeCollectionCreator();
      await refreshAfterChange(`Deleted folder "${collection.name}".`);
    } catch (error) {
      console.error("Could not delete folder", error);
      announce(friendlyError(error, "Could not delete this folder."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function moveDocument(
    documentId: number,
    collectionId: number | null,
  ) {
    if (isWorking) return;
    try {
      setBusy(`move-${documentId}`);

      await invoke("move_document", {
        documentId,
        collectionId,
      });

      await refreshAfterChange(
        collectionId === null
          ? "Moved paper to Unfiled."
          : "Moved paper to folder.",
      );
    } catch (error) {
      console.error("Could not move paper", error);
      announce(friendlyError(error, "Could not move this paper."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function buildEmbeddings() {
    if (isWorking) return;
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
      console.error("Could not refresh search index", error);
      setEmbeddingStatus(
        friendlyError(error, "Could not refresh the search index. Try again."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function addPdf() {
    if (isWorking) return;

    try {
      setBusy("import");

      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "PDF documents", extensions: ["pdf"] }],
      });

      if (!selected || Array.isArray(selected)) return;

      announce("Adding your paper and preparing it for search…");

      const result = await invoke<ImportResult>("import_pdf", {
        path: selected,
      });

      if (typeof selectedCollection === "number") {
        await invoke("move_document", {
          documentId: result.document_id,
          collectionId: selectedCollection,
        });
      }

      await refreshAfterChange(
        `Added ${result.filename}. It is ready to search with AI.`,
      );
    } catch (error) {
      console.error("Could not add PDF", error);
      announce(friendlyError(error, "Could not add this PDF."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function addFolder() {
    if (isWorking) return;

    try {
      setBusy("folder");

      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (!selected || Array.isArray(selected)) return;

      announce("Adding PDFs from this folder and preparing them for search…");

      const result = await invoke<FolderImportResult>("import_folder", {
        path: selected,
      });

      if (result.failed > 0) {
        console.warn("Some PDFs failed:", result.errors);
      }

      await refreshAfterChange(
        `Added ${result.imported} of ${result.discovered} PDFs${
          result.failed > 0 ? ` · ${result.failed} could not be added` : ""
        }.`,
        result.failed > 0 ? "warning" : "success",
      );
    } catch (error) {
      console.error("Could not import folder", error);
      announce(friendlyError(error, "Could not import this folder."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function reindexDocument(documentId: number) {
    if (isWorking) return;
    try {
      setBusy(`reindex-${documentId}`);

      const result = await invoke<ImportResult>("reindex_document", {
        documentId,
      });

      await refreshAfterChange(`Refreshed ${result.filename} for search.`);
    } catch (error) {
      console.error("Could not refresh paper", error);
      announce(friendlyError(error, "Could not refresh this paper."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function deleteDocument(documentId: number, filename: string) {
    if (isWorking) return;
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

      await refreshAfterChange(`Removed ${filename} from PaperLink.`);
    } catch (error) {
      console.error("Could not remove paper", error);
      announce(friendlyError(error, "Could not remove this paper."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isWorking) return;

    try {
      setBusy("search");
      setHasSearched(false);
      setResults([]);

      const found = await invoke<SearchResult[]>("search_hybrid", {
        query: trimmedQuery,
        limit: 8,
      });

      setResults(found);
      setHasSearched(true);
      announce(
        `${found.length} search result${found.length === 1 ? "" : "s"}.`,
        "success",
      );
    } catch (error) {
      console.error("Search failed", error);
      setHasSearched(false);
      announce(friendlyError(error, "Search could not finish. Try again."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function startTunnel() {
    if (isWorking) return;
    try {
      setBusy("tunnel");
      announce("Creating a temporary secure internet connection…");

      const connection = await invoke<TunnelConnection>("start_tunnel");

      setTunnelUrl(connection.url);
      setAccessToken(connection.token);
      setCompatibilityMode(false);
      announce(
        "Internet connection is ready. Password protection is on.",
        "success",
      );
    } catch (error) {
      console.error("Could not create internet connection", error);
      announce(
        friendlyError(error, "Could not create the internet connection."),
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  async function stopTunnel() {
    if (isWorking) return;
    try {
      setBusy("tunnel-stop");

      await invoke("stop_tunnel");

      setTunnelUrl(null);
      setAccessToken(null);
      setCompatibilityMode(false);
      announce("Temporary internet connection stopped.", "success");
    } catch (error) {
      console.error("Could not stop internet connection", error);
      announce(
        friendlyError(error, "Could not stop the internet connection."),
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  async function setClaudeCompatibility(enabled: boolean) {
    if (isWorking) return;
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

      announce(
        enabled
          ? "Password protection is off for this temporary connection."
          : "Password protection is back on.",
        enabled ? "warning" : "success",
      );
    } catch (error) {
      console.error("Could not change connection security", error);
      announce(
        friendlyError(error, "Could not change connection security."),
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpoint);
      announce("Connection address copied.", "success");
    } catch (error) {
      console.error("Could not copy connection address", error);
      announce("Could not copy the address. Select it and copy it manually.", "error");
    }
  }

  async function copyToken() {
    if (!accessToken) return;

    try {
      await navigator.clipboard.writeText(accessToken);
      announce("Connection password copied.", "success");
    } catch (error) {
      console.error("Could not copy connection password", error);
      announce("Could not copy the password. Select it and copy it manually.", "error");
    }
  }

  return (
    <>
      <TitleBar />
      <main className="shell">
        <header className="app-header">
        <nav className="primary-nav" aria-label="Main navigation">
          <button
            className={activeView === "library" ? "active" : ""}
            aria-current={activeView === "library" ? "page" : undefined}
            onClick={() => setActiveView("library")}
          >
            Library
          </button>
          <button
            className={activeView === "connect" ? "active" : ""}
            aria-current={activeView === "connect" ? "page" : undefined}
            onClick={() => setActiveView("connect")}
          >
            Connect AI
          </button>
          <button
            className={activeView === "activity" ? "active" : ""}
            aria-current={activeView === "activity" ? "page" : undefined}
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
        <div
          className={`app-message ${messageTone}`}
          role={messageTone === "error" ? "alert" : "status"}
          aria-live={messageTone === "error" ? "assertive" : "polite"}
        >
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
                <strong>{initialLoading ? "—" : status?.document_count ?? 0}</strong> papers
                <span aria-hidden="true">·</span>
                <strong>{initialLoading ? "—" : status?.chunk_count ?? 0}</strong> searchable sections
              </div>
            </div>

            <div className="page-actions">
              <button className="secondary" onClick={addFolder} disabled={isWorking}>
                {busy === "folder" ? "Adding folder…" : "Import folder"}
              </button>
              <button onClick={addPdf} disabled={isWorking}>
                {busy === "import" ? "Adding paper…" : "Add PDF"}
              </button>
            </div>
          </section>

          {initialLoading ? (
            <section className="state-panel" aria-busy="true" aria-live="polite">
              <strong>Loading your library…</strong>
              <span>Getting your papers and folders ready.</span>
            </section>
          ) : loadError ? (
            <section className="state-panel error-state" role="alert">
              <strong>Couldn’t load your library</strong>
              <span>{loadError}</span>
              <button onClick={() => void loadInitialData()}>Try again</button>
            </section>
          ) : documents.length === 0 ? (
            <section className="first-run">
              <div className="first-run-copy">
                <h2>Add your first past paper</h2>
                <p>
                  PaperLink keeps your PDFs on this computer, then prepares them
                  so your AI assistant can find the right parts when you ask a question.
                </p>
              </div>
              <div className="first-run-actions">
                <button onClick={addPdf} disabled={isWorking}>
                  Add a PDF
                </button>
                <button className="secondary" onClick={addFolder} disabled={isWorking}>
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
                    onClick={() => openCollectionCreator(null)}
                    disabled={isWorking}
                  >
                    New folder
                  </button>
                </div>

                {folderFormOpen && (
                  <form
                    className="new-folder-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createCollection();
                    }}
                  >
                    <label>
                      <span>
                        {folderParentName
                          ? `New folder inside ${folderParentName}`
                          : "New folder"}
                      </span>
                      <input
                        ref={folderInputRef}
                        value={folderDraft}
                        onChange={(event) => setFolderDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") closeCollectionCreator();
                        }}
                        maxLength={120}
                        placeholder="e.g. Mathematics 2026"
                        aria-label="Folder name"
                      />
                    </label>
                    <div className="new-folder-actions">
                      <button
                        type="button"
                        className="secondary small"
                        onClick={closeCollectionCreator}
                        disabled={isWorking}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="small"
                        disabled={isWorking || !folderDraft.trim()}
                      >
                        {busy === "create-collection" ? "Creating…" : "Create"}
                      </button>
                    </div>
                  </form>
                )}

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
                      style={{ paddingInlineStart: `${12 + depth * 16}px` }}
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
                          onClick={() =>
                            openCollectionCreator(
                              typeof selectedCollection === "number"
                                ? selectedCollection
                                : null,
                            )
                          }
                          disabled={isWorking}
                        >
                          New subfolder
                        </button>
                        <details className="menu">
                          <summary>Folder options</summary>
                          <div className="menu-popover">
                            <button
                              className="menu-danger"
                              onClick={deleteSelectedCollection}
                              disabled={isWorking}
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
                          disabled={isWorking}
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
                              disabled={isWorking}
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
                                disabled={isWorking}
                              >
                                {reindexing ? "Refreshing…" : "Refresh for search"}
                              </button>
                              <button
                                className="menu-danger"
                                onClick={() => deleteDocument(doc.id, doc.filename)}
                                disabled={isWorking}
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

          {initialLoading ? (
            <section className="state-panel" aria-busy="true" aria-live="polite">
              <strong>Checking PaperLink…</strong>
              <span>Confirming the local connection is ready.</span>
            </section>
          ) : loadError ? (
            <section className="state-panel error-state" role="alert">
              <strong>Couldn’t check the connection</strong>
              <span>{loadError}</span>
              <button onClick={() => void loadInitialData()}>Try again</button>
            </section>
          ) : (
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
              <button
                className="secondary"
                onClick={copyEndpoint}
                disabled={isWorking}
              >
                Copy address
              </button>
            </div>

            <div className="connection-actions">
              {!tunnelUrl ? (
                <button onClick={startTunnel} disabled={isWorking}>
                  {busy === "tunnel" ? "Connecting…" : "Allow internet connection"}
                </button>
              ) : (
                <button
                  className="danger-button"
                  onClick={stopTunnel}
                  disabled={isWorking}
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
                    disabled={isWorking}
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
                    <button
                      className="secondary small"
                      onClick={copyToken}
                      disabled={isWorking}
                    >
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
          )}
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (!event.target.value.trim()) {
                    setHasSearched(false);
                    setResults([]);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") search();
                }}
                placeholder="Try a question or topic…"
                aria-label="Search all papers"
                maxLength={500}
              />

              <button
                onClick={search}
                disabled={isWorking || !query.trim()}
              >
                {busy === "search" ? "Searching…" : "Search"}
              </button>
            </div>

            <div className="results" aria-live="polite">
              {hasSearched && busy !== "search" && results.length === 0 && (
                <div className="empty-state search-empty">
                  <strong>No matching sections found</strong>
                  <span>Try a shorter phrase, a different keyword, or a question from another topic.</span>
                </div>
              )}

              {results.map((result) => (
                <article className="result" key={result.chunk_id}>
                  <div className="result-meta">
                    <strong title={result.filename}>{result.filename}</strong>
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
              <span className={`live-label ${activityError ? "retrying" : ""}`}>
                <span className="status-dot" />
                {activityError ? "Retrying" : "Live"}
              </span>
            </div>

            {activityError && (
              <div className="inline-error" role="alert">
                <span>{activityError}</span>
                <button className="secondary small" onClick={() => void refreshActivity()}>
                  Try again
                </button>
              </div>
            )}

            <div className="activity-list" aria-live="polite">
              {!activityError && activity.length === 0 && (
                <div className="empty-state compact-empty">
                  <strong>No AI requests yet</strong>
                  <span>They will appear here when a connected client uses PaperLink.</span>
                </div>
              )}

              {activity.map((event) => (
                <div className="activity-item" key={event.id}>
                  <time
                    dateTime={new Date(event.timestamp_ms).toISOString()}
                    title={new Date(event.timestamp_ms).toLocaleString()}
                  >
                    {new Intl.DateTimeFormat(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    }).format(new Date(event.timestamp_ms))}
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
    </>
  );
}
