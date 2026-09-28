/**
 * The agentic loop: Claude tool_use → execute → feed back → repeat.
 *
 * Each turn:
 *  1. Persist the user's message.
 *  2. Load recent history (+ stored summary) from memory.
 *  3. Call Claude with tool definitions.
 *  4. Execute every requested tool and append tool_result blocks.
 *  5. Repeat until Claude answers in text or MAX_ITERATIONS is hit.
 *  6. Persist the assistant's reply and trigger summarisation if needed.
 */

import { toolDefinitions } from "./tools/index.js";

const SYSTEM_PROMPT = `You are a helpful, concise personal assistant inside Slack.
You can search the web for current information, do arithmetic with the
calculator, and save/search the user's personal notes.

Guidelines:
- Prefer tools over guessing: use web_search for anything time-sensitive or
  factual you are unsure about, and calculator for any arithmetic.
- When the user asks you to remember something, save it with notes_save.
- Keep replies short and chat-friendly. Use Slack mrkdwn sparingly.
- Never claim a tool result you did not actually get back.`;

/**
 * Extract plain text from a Claude content block list.
 */
function extractText(content) {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Run one agentic turn.
 *
 * @param {{
 *   userId: string,
 *   input: string,
 *   anthropic: { messages: { create: Function } },
 *   model?: string,
 *   maxIterations?: number,
 *   dispatch: Record<string, (input: object, ctx: { userId: string }) => Promise<string>>,
 *   memory: { save: Function, load: Function, getSummary: Function, maybeSummarize: Function },
 * }} options
 * @returns {Promise<string>} the assistant's final text reply
 */
export async function runAgent({
  userId,
  input,
  anthropic,
  model = "claude-sonnet-4-20250514",
  maxIterations = 8,
  dispatch,
  memory,
}) {
  if (!input || !input.trim()) return "I didn't catch that — could you say it again?";

  await memory.save(userId, "user", input);

  const summary = await memory.getSummary(userId);
  const system = summary
    ? `${SYSTEM_PROMPT}\n\nConversation summary so far:\n${summary}`
    : SYSTEM_PROMPT;

  const messages = (await memory.load(userId)).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalText = "";
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools: toolDefinitions,
      messages,
    });

    messages.push({
      role: "assistant",
      content: response.content,
    });

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    finalText = extractText(response.content);

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      break;
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      const executor = dispatch[toolUse.name];
      if (!executor) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Unknown tool "${toolUse.name}"`,
          is_error: true,
        });
        continue;
      }
      try {
        const result = await executor(toolUse.input ?? {}, { userId });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: String(result),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Tool "${toolUse.name}" failed: ${err.message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });

    if (iteration === maxIterations && response.stop_reason === "tool_use") {
      finalText =
        finalText ||
        "I ran out of steps working on that — could you rephrase or narrow it down?";
    }
  }

  const reply =
    finalText || "Sorry, I couldn't come up with a response to that.";
  await memory.save(userId, "assistant", reply);
  // Best-effort: summarisation failures must never break the reply.
  try {
    await memory.maybeSummarize(userId);
  } catch (err) {
    console.warn(`[agent] summarisation skipped: ${err.message}`);
  }
  return reply;
}
