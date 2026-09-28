/**
 * Shared wiring: builds the Anthropic client, notes store, memory and tool
 * dispatch used by both the dev REPL and the Slack app.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { buildDispatch } from "./tools/index.js";
import { createNotesStore } from "./tools/notes.js";
import { Memory } from "./memory.js";

/**
 * @returns {Promise<{ anthropic, dispatch, memory, model, maxIterations }>}
 */
export async function createAssistant() {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  let pool = null;
  if (config.databaseUrl) {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: config.databaseUrl });
  }

  const notes = await createNotesStore({ pool });
  const memory = new Memory({
    pool,
    anthropic,
    model: config.model,
    historyLimit: config.historyLimit,
    summarizeThreshold: config.summarizeThreshold,
  });
  // Surface table-creation failures early rather than mid-conversation.
  await memory.ready.catch((err) => {
    console.error(`[assistant] database initialisation failed: ${err.message}`);
    process.exit(1);
  });

  return {
    anthropic,
    dispatch: buildDispatch({ notes }),
    memory,
    model: config.model,
    maxIterations: config.maxIterations,
  };
}
