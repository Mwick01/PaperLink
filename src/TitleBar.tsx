import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

function runWindowAction(action: () => Promise<void>, label: string) {
  void action().catch((error) => {
    console.error(`Could not ${label} PaperLink window`, error);
  });
}

export default function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region="">
      <div className="titlebar-brand" data-tauri-drag-region="">
        <span className="titlebar-mark" data-tauri-drag-region="" aria-hidden="true">
          P
        </span>
        <span className="titlebar-name" data-tauri-drag-region="">
          PaperLink
        </span>
      </div>

      <div className="titlebar-drag-space" data-tauri-drag-region="" />

      <div className="window-controls" aria-label="Window controls">
        <button
          className="window-control"
          type="button"
          title="Minimize"
          aria-label="Minimize PaperLink"
          onClick={() => runWindowAction(() => appWindow.minimize(), "minimize")}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 8.5h8" />
          </svg>
        </button>

        <button
          className="window-control"
          type="button"
          title="Maximize or restore"
          aria-label="Maximize or restore PaperLink"
          onClick={() =>
            runWindowAction(() => appWindow.toggleMaximize(), "toggle maximize")
          }
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.25" y="2.25" width="7.5" height="7.5" rx="0.5" />
          </svg>
        </button>

        <button
          className="window-control window-control-close"
          type="button"
          title="Close"
          aria-label="Close PaperLink"
          onClick={() => runWindowAction(() => appWindow.close(), "close")}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
    </header>
  );
}
