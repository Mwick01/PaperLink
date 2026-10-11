import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type DocumentRow = {
  id: number;
  filename: string;
  chunk_count: number;
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

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Ready");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  const endpoint = useMemo(
    () => tunnelUrl ? `${tunnelUrl}/mcp` : status?.mcp_url ?? "http://127.0.0.1:8765/mcp",
    [status, tunnelUrl]
  );

  async function refresh() {
    const [nextStatus, nextDocs] = await Promise.all([
      invoke<AppStatus>("get_status"),
      invoke<DocumentRow[]>("list_documents")
    ]);
    setStatus(nextStatus);
    setDocuments(nextDocs);
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  async function addPdf() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }]
    });
    if (!selected || Array.isArray(selected)) return;

    try {
      setBusy("import");
      setMessage("Extracting and indexing PDF…");
      const result = await invoke<ImportResult>("import_pdf", { path: selected });
      setMessage(`Indexed ${result.filename} (${result.chunks_added} chunks)`);
      await refresh();
    } catch (error) {
      setMessage(`Import failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    if (!query.trim()) return;
    try {
      setBusy("search");
      const found = await invoke<SearchResult[]>("search_local", { query, limit: 8 });
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
      setMessage("Starting temporary HTTPS tunnel…");
      const url = await invoke<string>("start_tunnel");
      setTunnelUrl(url);
      setMessage("Temporary internet access is online");
    } catch (error) {
      setMessage(`Tunnel failed: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function stopTunnel() {
    try {
      await invoke("stop_tunnel");
      setTunnelUrl(null);
      setMessage("Temporary internet access stopped");
    } catch (error) {
      setMessage(`Could not stop tunnel: ${String(error)}`);
    }
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint);
    setMessage("MCP endpoint copied");
  }

  async function refreshActivity() {
  try {
    const events = await invoke<ActivityEvent[]>("get_activity");
    setActivity(events);
  } catch (error) {
    console.error("Could not load MCP activity", error);
  }

  useEffect(() => {
    refreshActivity();

    const timer = window.setInterval(() => {
      refreshActivity();
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);
}

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">LOCAL-FIRST KNOWLEDGE</div>
          <h1>PaperLink</h1>
          <p>Your documents stay on this computer. Search them locally and expose only retrieved context through MCP.</p>
        </div>
        <div className="status-pill"><span className="dot" /> MCP running</div>
      </header>

      <section className="grid stats">
        <article className="card metric">
          <span>Documents</span>
          <strong>{status?.document_count ?? 0}</strong>
        </article>
        <article className="card metric">
          <span>Indexed chunks</span>
          <strong>{status?.chunk_count ?? 0}</strong>
        </article>
        <article className="card metric endpoint-card">
          <span>Current MCP endpoint</span>
          <code>{endpoint}</code>
          <button className="ghost" onClick={copyEndpoint}>Copy</button>
        </article>
      </section>

      <section className="grid main-grid">
        <article className="card library">
          <div className="card-head">
            <div>
              <h2>Knowledge library</h2>
              <p>PDF text is extracted and indexed into a local SQLite database.</p>
            </div>
            <button onClick={addPdf} disabled={busy === "import"}>{busy === "import" ? "Indexing…" : "+ Add PDF"}</button>
          </div>

          <div className="doc-list">
            {documents.length === 0 && <div className="empty">No documents yet. Add a PDF to create your local knowledge base.</div>}
            {documents.map((doc) => (
              <div className="doc" key={doc.id}>
                <div className="file-icon">PDF</div>
                <div className="doc-copy">
                  <strong>{doc.filename}</strong>
                  <span>{doc.chunk_count} chunks</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card connection">
          <h2>Internet access</h2>
          <p>Use a temporary Cloudflare tunnel when a browser-based AI client needs to reach this local MCP server.</p>
          <div className={`connection-state ${tunnelUrl ? "online" : ""}`}>
            <span className="dot" /> {tunnelUrl ? "Online" : "Local only"}
          </div>
          {!tunnelUrl ? (
            <button className="wide" onClick={startTunnel} disabled={busy === "tunnel"}>{busy === "tunnel" ? "Connecting…" : "Start temporary tunnel"}</button>
          ) : (
            <button className="wide danger" onClick={stopTunnel}>Stop tunnel</button>
          )}
          <small>Requires <code>cloudflared</code> to be installed and available on PATH for this MVP.</small>
        </article>
      </section>
      <section className="card activity-card">
        <div className="card-head">
          <div>
            <h2>Recent MCP activity</h2>
            <p>
              Tool calls received from connected AI clients appear here.
            </p>
          </div>

          <div className="live-badge">
            <span className="dot" />
            Live
          </div>
        </div>

        <div className="activity-list">
          {activity.length === 0 && (
            <div className="empty">
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

                {event.detail && (
                  <code>{event.detail}</code>
                )}

                <span>{event.result}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      
      <section className="card search-card">
        <div className="card-head">
          <div>
            <h2>Test local retrieval</h2>
            <p>This uses the same SQLite FTS search exposed to AI clients through MCP.</p>
          </div>
        </div>
        <div className="search-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="e.g. projectile motion, integration by parts, photosynthesis"
          />
          <button onClick={search} disabled={busy === "search"}>{busy === "search" ? "Searching…" : "Search"}</button>
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
      </section>

      <footer>{message}</footer>
    </main>
  );
}
