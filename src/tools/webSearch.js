/**
 * Web search via the DuckDuckGo Instant Answer API (no API key required).
 *
 * Endpoint: https://api.duckduckgo.com/?q=...&format=json
 * Returns the instant-answer abstract plus a handful of related topics.
 * Graceful degradation: network failures raise a descriptive Error which the
 * agent loop surfaces to Claude as a failed tool result.
 */

/**
 * Parse a DuckDuckGo Instant Answer API JSON payload into concise results.
 * Exported separately so it can be unit-tested without network access.
 * @param {object} data - parsed JSON from the Instant Answer API
 * @param {string} query - the original search query
 * @param {number} limit - max number of related topics to include
 * @returns {{ query: string, abstract: string, source: string, results: Array<{title: string, url: string, snippet: string}> }}
 */
export function parseInstantAnswer(data, query, limit = 5) {
  const results = [];
  const pushTopic = (topic) => {
    if (results.length >= limit) return;
    if (!topic || typeof topic !== "object") return;
    // RelatedTopics can nest groups under a "Topics" key.
    if (Array.isArray(topic.Topics)) {
      topic.Topics.forEach(pushTopic);
      return;
    }
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(" - ")[0].slice(0, 120),
        url: topic.FirstURL,
        snippet: topic.Text.slice(0, 280),
      });
    }
  };
  (data?.RelatedTopics ?? []).forEach(pushTopic);

  return {
    query,
    abstract: (data?.AbstractText ?? "").slice(0, 500),
    source: data?.AbstractSource ?? "",
    results,
  };
}

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "agentic-workflow-assistant/1.0" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from search API`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Search request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a web search and return concise, agent-ready results.
 * @param {string} query
 * @param {{ limit?: number }} [options]
 * @returns {Promise<object>}
 */
export async function webSearch(query, { limit = 5 } = {}) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("Search query must be a non-empty string");
  }
  const params = new URLSearchParams({
    q: query.trim(),
    format: "json",
    no_html: "1",
    skip_disambig: "1",
  });
  let data;
  try {
    data = await fetchWithTimeout(
      `https://api.duckduckgo.com/?${params.toString()}`,
    );
  } catch (err) {
    throw new Error(`Web search failed: ${err.message}`);
  }
  return parseInstantAnswer(data, query.trim(), limit);
}

/** Tool wrapper returning a readable string for the agent loop. */
export async function webSearchTool({ query }) {
  const { abstract, source, results } = await webSearch(query);
  const lines = [];
  if (abstract) {
    lines.push(`Summary: ${abstract}${source ? ` (Source: ${source})` : ""}`);
  }
  for (const r of results) {
    lines.push(`- ${r.title}: ${r.snippet} [${r.url}]`);
  }
  if (lines.length === 0) {
    return `No instant-answer results found for "${query}".`;
  }
  return lines.join("\n");
}
