/**
 * Postgres-backed conversation memory.
 *
 * Design:
 * - Every user/assistant message is stored in `messages`.
 * - On each turn the last `historyLimit` messages are loaded into context.
 * - When a user's history grows past `summarizeThreshold` messages, the older
 *   half is summarised via Claude into `summaries` and deleted, keeping the
 *   context window bounded while preserving long-term recall.
 * - If DATABASE_URL is unset, memory is in-process only (a Map) with a clear
 *   logged warning — the assistant still works, it just forgets on restart.
 * - If ANTHROPIC_API_KEY is unset, summarisation is skipped gracefully and the
 *   raw history is kept.
 */

const MESSAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_user_id_id ON messages (user_id, id);
`;

const SUMMARIES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS summaries (
  user_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let warnedInMemory = false;
function warnInMemory() {
  if (warnedInMemory) return;
  warnedInMemory = true;
  console.warn(
    "[memory] WARNING: DATABASE_URL is not set — conversation memory is " +
      "in-process only and will be lost on restart. Set DATABASE_URL to " +
      "persist memory in Postgres.",
  );
}

export class Memory {
  /**
   * @param {{
   *   pool?: import("pg").Pool | null,
   *   anthropic?: { messages: { create: Function } } | null,
   *   model?: string,
   *   historyLimit?: number,
   *   summarizeThreshold?: number,
   * }} [options]
   */
  constructor({
    pool = null,
    anthropic = null,
    model = "claude-sonnet-4-20250514",
    historyLimit = 20,
    summarizeThreshold = 40,
  } = {}) {
    this.pool = pool;
    this.anthropic = anthropic;
    this.model = model;
    this.historyLimit = historyLimit;
    this.summarizeThreshold = summarizeThreshold;
    this.local = new Map(); // userId -> [{ role, content }]
    this.localSummaries = new Map(); // userId -> summary string
    this.ready = pool
      ? pool
          .query(MESSAGES_TABLE_SQL + SUMMARIES_TABLE_SQL)
          .catch((err) => {
            throw new Error(`Failed to initialise memory tables: ${err.message}`);
          })
      : Promise.resolve(warnInMemory());
  }

  async save(userId, role, content) {
    await this.ready;
    if (!this.pool) {
      const arr = this.local.get(userId) ?? [];
      arr.push({ role, content });
      this.local.set(userId, arr);
      return;
    }
    await this.pool.query(
      "INSERT INTO messages (user_id, role, content) VALUES ($1, $2, $3)",
      [userId, role, content],
    );
  }

  /** Load the most recent messages for context, oldest first. */
  async load(userId) {
    await this.ready;
    if (!this.pool) {
      const arr = this.local.get(userId) ?? [];
      return arr.slice(-this.historyLimit);
    }
    const { rows } = await this.pool.query(
      `SELECT role, content FROM messages
       WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
      [userId, this.historyLimit],
    );
    return rows.reverse();
  }

  async getSummary(userId) {
    await this.ready;
    if (!this.pool) return this.localSummaries.get(userId) ?? null;
    const { rows } = await this.pool.query(
      "SELECT summary FROM summaries WHERE user_id = $1",
      [userId],
    );
    return rows[0]?.summary ?? null;
  }

  /**
   * If history exceeds the threshold, summarise the older half via Claude,
   * store the merged summary, and delete the summarised rows. Skips gracefully
   * when there is no DB pool or no Anthropic client.
   */
  async maybeSummarize(userId) {
    await this.ready;
    if (!this.pool || !this.anthropic) return;
    const { rows } = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM messages WHERE user_id = $1",
      [userId],
    );
    const count = rows[0].n;
    if (count <= this.summarizeThreshold) return;

    const toSummarize = Math.floor(count / 2);
    const { rows: old } = await this.pool.query(
      `SELECT id, role, content FROM messages
       WHERE user_id = $1 ORDER BY id ASC LIMIT $2`,
      [userId, toSummarize],
    );
    const transcript = old
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");
    const existing = (await this.getSummary(userId)) ?? "None yet.";

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 500,
      system:
        "You summarise conversation history for a personal assistant. " +
        "Produce a compact paragraph of durable facts, preferences, and " +
        "open threads. Do not invent details.",
      messages: [
        {
          role: "user",
          content:
            `Existing summary:\n${existing}\n\n` +
            `Older conversation to fold in:\n${transcript}\n\n` +
            "Write the updated summary.",
        },
      ],
    });
    const newSummary = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    await this.pool.query(
      `INSERT INTO summaries (user_id, summary, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET summary = $2, updated_at = NOW()`,
      [userId, newSummary],
    );
    const ids = old.map((m) => m.id);
    await this.pool.query("DELETE FROM messages WHERE id = ANY($1::int[])", [ids]);
  }
}
