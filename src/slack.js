#!/usr/bin/env node
/**
 * Slack entry point: runs the assistant in Socket Mode (no public HTTP
 * endpoint needed). Responds to DMs and @-mentions in channels.
 */

import pkg from "@slack/bolt";
const { App } = pkg;
import { config, requireEnv } from "./config.js";
import { createAssistant } from "./assistant.js";
import { runAgent } from "./agent.js";

requireEnv([
  ["SLACK_BOT_TOKEN", config.slackBotToken],
  ["SLACK_APP_TOKEN", config.slackAppToken],
  ["ANTHROPIC_API_KEY", config.anthropicApiKey],
]);

const { anthropic, dispatch, memory, model, maxIterations } =
  await createAssistant();

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
});

/** Our own bot user ID, resolved at startup for @-mention detection. */
let botUserId = null;

async function handleMessage({ message, say }) {
  // Ignore bot messages, edits and other subtypes.
  if (message.subtype || message.bot_id) return;
  const text = (message.text ?? "").trim();
  if (!text) return;

  const isDM = message.channel_type === "im";
  const mentioned = botUserId && text.includes(`<@${botUserId}>`);
  if (!isDM && !mentioned) return;

  // Strip the bot mention for cleaner prompts in channels.
  const cleaned = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleaned) return;

  const userId = message.user;
  try {
    const reply = await runAgent({
      userId,
      input: cleaned,
      anthropic,
      model,
      maxIterations,
      dispatch,
      memory,
    });
    await say({ text: reply, thread_ts: message.thread_ts ?? message.ts });
  } catch (err) {
    console.error(`[slack] agent error for user ${userId}: ${err.message}`);
    await say({
      text: "Sorry, something went wrong on my end. Try again in a moment.",
      thread_ts: message.thread_ts ?? message.ts,
    });
  }
}

app.message(handleMessage);

app.error(async (error) => {
  console.error(`[slack] bolt error: ${error.message}`);
});

await app.start();
// Cache our own bot user ID so @-mentions in channels are detected.
({ user_id: botUserId } = await app.client.auth.test());
console.log("⚡ Agentic workflow assistant is running in Socket Mode");
