import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInstantAnswer } from "../src/tools/webSearch.js";

// A realistic DuckDuckGo Instant Answer API payload fixture — parsing is
// tested offline; the live HTTP call is exercised manually (see README).
const FIXTURE = {
  AbstractText: "Node.js is a JavaScript runtime built on Chrome's V8 engine.",
  AbstractSource: "Wikipedia",
  RelatedTopics: [
    {
      Text: "Node.js - open-source, cross-platform JavaScript runtime environment",
      FirstURL: "https://duckduckgo.com/node.js",
    },
    {
      Name: "grouped",
      Topics: [
        {
          Text: "npm - package manager for Node.js",
          FirstURL: "https://duckduckgo.com/npm",
        },
      ],
    },
    { Text: "topic without a URL" },
  ],
};

describe("webSearch parser", () => {
  it("extracts the abstract and flattens nested topics", () => {
    const parsed = parseInstantAnswer(FIXTURE, "node.js", 5);
    assert.equal(parsed.query, "node.js");
    assert.ok(parsed.abstract.includes("JavaScript runtime"));
    assert.equal(parsed.source, "Wikipedia");
    assert.equal(parsed.results.length, 2);
    assert.equal(parsed.results[0].url, "https://duckduckgo.com/node.js");
    assert.equal(parsed.results[1].title, "npm");
  });

  it("respects the limit and handles empty payloads", () => {
    const parsed = parseInstantAnswer(FIXTURE, "node.js", 1);
    assert.equal(parsed.results.length, 1);
    const empty = parseInstantAnswer({}, "nothing", 5);
    assert.equal(empty.results.length, 0);
    assert.equal(empty.abstract, "");
  });
});
