/**
 * Per-user notes: save / list / search.
 *
 * Primary backend: Postgres (when DATABASE_URL is set), table `notes`.
 * Fallback: a local JSON file, so the assistant still works in dev without a
 * database. A clear warning is logged exactly once per process when the
 * fallback is in use.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const NOTES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes (user_id);
`;

let warnedFallback = false;
function warnFallback(reason) {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(
    `[notes] WARNING: using local JSON file fallback (${reason}). ` +
      "Set DATABASE_URL to persist notes in Postgres.",
  );
}

class PostgresNotes {
  /** @param {import("pg").Pool} pool */
  constructor(pool) {
    this.pool = pool;
    this.ready = pool.query(NOTES_TABLE_SQL).catch((err) => {
      throw new Error(`Failed to initialise notes table: ${err.message}`);
    });
  }

  async save(userId, body) {
    await this.ready;
    const { rows } = await this.pool.query(
      "INSERT INTO notes (user_id, body) VALUES ($1, $2) RETURNING id, created_at",
      [userId, body],
    );
    return { id: rows[0].id, user_id: userId, body, created_at: rows[0].created_at };
  }

  async list(userId, limit = 20) {
    await this.ready;
    const { rows } = await this.pool.query(
      "SELECT id, user_id, body, created_at FROM notes WHERE user_id = $1 ORDER BY id DESC LIMIT $2",
      [userId, limit],
    );
    return rows;
  }

  async search(userId, query, limit = 20) {
    await this.ready;
    // Escape LIKE wildcards in the user query so it is matched literally.
    const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { rows } = await this.pool.query(
      `SELECT id, user_id, body, created_at FROM notes
       WHERE user_id = $1 AND body ILIKE '%' || $2 || '%' ESCAPE '\\'
       ORDER BY id DESC LIMIT $3`,
      [userId, escaped, limit],
    );
    return rows;
  }
}

class JsonNotes {
  /** @param {string} dataDir directory holding notes.json */
  constructor(dataDir) {
    this.filePath = join(dataDir, "notes.json");
    this.ready = mkdir(dataDir, { recursive: true });
  }

  async _readAll() {
    await this.ready;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.notes) ? parsed.notes : [];
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw new Error(`Failed to read notes file: ${err.message}`);
    }
  }

  async _writeAll(notes) {
    await writeFile(this.filePath, JSON.stringify({ notes }, null, 2), "utf8");
  }

  async save(userId, body) {
    const notes = await this._readAll();
    const note = {
      id: notes.length === 0 ? 1 : notes[notes.length - 1].id + 1,
      user_id: userId,
      body,
      created_at: new Date().toISOString(),
    };
    notes.push(note);
    await this._writeAll(notes);
    return note;
  }

  async list(userId, limit = 20) {
    const notes = await this._readAll();
    return notes.filter((n) => n.user_id === userId).slice(-limit).reverse();
  }

  async search(userId, query, limit = 20) {
    const notes = await this._readAll();
    const q = query.toLowerCase();
    return notes
      .filter((n) => n.user_id === userId && n.body.toLowerCase().includes(q))
      .slice(-limit)
      .reverse();
  }
}

/**
 * Create a notes store.
 *
 * @param {{ pool?: import("pg").Pool, dataDir?: string }} [options]
 *   - pool: an existing pg Pool. If omitted but DATABASE_URL is set, a pool
 *     is created automatically. If DATABASE_URL is unset, the JSON fallback
 *     is used.
 *   - dataDir: directory for the JSON fallback file (tests can inject a
 *     temp dir).
 */
export async function createNotesStore({ pool = null, dataDir } = {}) {
  if (pool) {
    return new PostgresNotes(pool);
  }
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    return new PostgresNotes(new Pool({ connectionString: process.env.DATABASE_URL }));
  }
  warnFallback("DATABASE_URL is not set");
  const dir =
    dataDir ??
    process.env.ASSISTANT_DATA_DIR ??
    `${process.env.HOME ?? "/tmp"}/.agentic-workflow-assistant`;
  return new JsonNotes(dir);
}

/** Format a note list for display / agent consumption. */
function formatNotes(notes) {
  if (notes.length === 0) return "No notes found.";
  return notes
    .map((n) => `#${n.id} [${n.created_at}]: ${n.body}`)
    .join("\n");
}

/** Tool wrappers (user_id is injected by the agent loop). */
export async function notesSaveTool(store, userId, { text }) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Note text must be a non-empty string");
  }
  const note = await store.save(userId, text.trim());
  return `Saved note #${note.id}: ${note.body}`;
}

export async function notesListTool(store, userId, { limit = 20 } = {}) {
  const notes = await store.list(userId, limit);
  return formatNotes(notes);
}

export async function notesSearchTool(store, userId, { query }) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("Search query must be a non-empty string");
  }
  const notes = await store.search(userId, query.trim());
  return formatNotes(notes);
}
