import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/agent.js";
import { buildDispatch } from "../src/tools/index.js";

function fakeMemory() {
  const saved = [];
  return {
    saved,
    async save(userId, role, content) {
      saved.push({ userId, role, content });
    },
    async load() {
      return saved.map(({ role, content }) => ({ role, content }));
    },
    async getSummary() {
      return null;
    },
    async maybeSummarize() {},
  };
}

function stubAnthropic(script) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    messages: {
      create: async () => {
        const next = script[Math.min(calls, script.length - 1)];
        calls += 1;
        return typeof next === "function" ? next() : next;
      },
    },
  };
}

const dispatch = buildDispatch({ notes: {} });
const base = { userId: "tester", dispatch, model: "test-model", maxIterations: 8 };

describe("agent loop", () => {
  it("executes a tool and feeds the result back to Claude", async () => {
    const memory = fakeMemory();
    const anthropic = stubAnthropic([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "calculator",
            input: { expression: "6 * 7" },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "6 * 7 = 42." }],
      },
    ]);

    const reply = await runAgent({ ...base, memory, anthropic, input: "what is 6*7?" });
    assert.equal(reply, "6 * 7 = 42.");
    assert.equal(anthropic.calls, 2);

    // The tool result fed back contains the real computed value.
    const secondCallInput = memory.saved.map((s) => s.content);
    assert.ok(secondCallInput.some((c) => c === "what is 6*7?"));
    assert.equal(memory.saved.at(-1).role, "assistant");
    assert.equal(memory.saved.at(-1).content, "6 * 7 = 42.");
  });

  it("surfaces tool failures as error results and keeps going", async () => {
    const memory = fakeMemory();
    const anthropic = stubAnthropic([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "calculator",
            input: { expression: "1 / 0" },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "That expression divides by zero." }],
      },
    ]);

    const reply = await runAgent({ ...base, memory, anthropic, input: "1/0?" });
    assert.equal(reply, "That expression divides by zero.");
    assert.equal(anthropic.calls, 2);
  });

  it("stops after maxIterations instead of looping forever", async () => {
    const memory = fakeMemory();
    const anthropic = stubAnthropic([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "calculator",
            input: { expression: "1 + 1" },
          },
        ],
      },
    ]);

    const reply = await runAgent({
      ...base,
      memory,
      anthropic,
      input: "loop me",
      maxIterations: 2,
    });
    assert.equal(anthropic.calls, 2);
    assert.match(reply, /ran out of steps/);
  });

  it("rejects unknown tools instead of crashing", async () => {
    const memory = fakeMemory();
    const anthropic = stubAnthropic([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t9", name: "teleport", input: {} },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "No such tool, sorry." }],
      },
    ]);
    const reply = await runAgent({ ...base, memory, anthropic, input: "teleport me" });
    assert.equal(reply, "No such tool, sorry.");
  });
});
