PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY(parent_id)
        REFERENCES collections(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collections_parent
ON collections(parent_id);


CREATE TABLE IF NOT EXISTS collection_documents (
    document_id INTEGER PRIMARY KEY,
    collection_id INTEGER NOT NULL,

    FOREIGN KEY(document_id)
        REFERENCES documents(id)
        ON DELETE CASCADE,

    FOREIGN KEY(collection_id)
        REFERENCES collections(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collection_documents_collection
ON collection_documents(collection_id);