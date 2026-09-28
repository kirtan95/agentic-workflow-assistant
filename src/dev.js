#!/usr/bin/env node
/**
 * Dev mode: terminal REPL driving the same agentic loop as Slack.
 * Requires ANTHROPIC_API_KEY; Slack tokens are NOT needed here.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { config, requireEnv } from "./config.js";
import { createAssistant } from "./assistant.js";
import { runAgent } from "./agent.js";

requireEnv([["ANTHROPIC_API_KEY", config.anthropicApiKey]]);

const { anthropic, dispatch, memory, model, maxIterations } =
  await createAssistant();

console.log("Agentic workflow assistant — dev REPL");
console.log("Type your message and press Enter. /quit to exit.\n");

const rl = createInterface({ input, output, prompt: "> " });
const userId = `dev-${process.env.USER ?? "local"}`;

rl.prompt();
for await (const line of rl) {
  const text = line.trim();
  if (text === "/quit" || text === "/exit") break;
  if (!text) {
    rl.prompt();
    continue;
  }
  try {
    const reply = await runAgent({
      userId,
      input: text,
      anthropic,
      model,
      maxIterations,
      dispatch,
      memory,
    });
    console.log(`\n${reply}\n`);
  } catch (err) {
    console.error(`\n[error] ${err.message}\n`);
  }
  rl.prompt();
}
rl.close();
console.log("Bye!");
