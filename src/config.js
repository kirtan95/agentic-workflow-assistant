/**
 * Centralised configuration for the agentic workflow assistant.
 *
 * Everything is read from the environment so the same code runs in dev REPL
 * mode (no Slack tokens needed) and in Slack Socket Mode.
 */

export const config = {
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  slackAppToken: process.env.SLACK_APP_TOKEN ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
  /** Cap on agentic tool-use round trips per user message. */
  maxIterations: Number.parseInt(process.env.MAX_ITERATIONS ?? "8", 10),
  /** How many recent messages are loaded into context each turn. */
  historyLimit: 20,
  /** When history passes this many messages, the older half is summarised. */
  summarizeThreshold: 40,
  /** Where the notes JSON fallback lives when DATABASE_URL is unset. */
  dataDir:
    process.env.ASSISTANT_DATA_DIR ??
    `${process.env.HOME ?? "/tmp"}/.agentic-workflow-assistant`,
};

/**
 * Fail fast with a helpful message when a required credential is missing.
 * @param {Array<[string, string]>} required - pairs of [envVarName, value]
 */
export function requireEnv(required) {
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    const hint =
      "Set them in your environment or in a .env file (see .env.example).";
    console.error(
      `Missing required environment variable(s): ${missing.join(", ")}. ${hint}`,
    );
    process.exit(1);
  }
}
