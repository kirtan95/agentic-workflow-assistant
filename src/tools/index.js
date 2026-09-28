/**
 * Tool registry: Claude tool definitions + the dispatch table that executes
 * them. Each entry is { definition, execute } where `execute(input, ctx)`
 * resolves to a string (or throws).
 */

import { calculatorTool } from "./calculator.js";
import { webSearchTool } from "./webSearch.js";
import { notesSaveTool, notesListTool, notesSearchTool } from "./notes.js";

export const toolDefinitions = [
  {
    name: "web_search",
    description:
      "Search the web for current information (news, facts, prices, docs). " +
      "Returns an instant-answer summary plus a few related results with URLs.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query, e.g. 'Node.js 20 release date'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calculator",
    description:
      "Evaluate an arithmetic expression safely (+ - * / % ^, parentheses, " +
      "decimals, unary minus). Use this for any math instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Arithmetic expression, e.g. '(15 * 1.2) ^ 2'",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "notes_save",
    description:
      "Save a short personal note for the current user so you can recall it later.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The note text to save" },
      },
      required: ["text"],
    },
  },
  {
    name: "notes_list",
    description: "List the current user's saved notes, most recent first.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max notes to return (default 20)",
          minimum: 1,
          maximum: 50,
        },
      },
    },
  },
  {
    name: "notes_search",
    description: "Search the current user's saved notes by keyword.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword to search for" },
      },
      required: ["query"],
    },
  },
];

/**
 * Build the dispatch map bound to a concrete notes store.
 * @param {{ notes: object }} deps
 */
export function buildDispatch({ notes }) {
  return {
    web_search: (input) => webSearchTool(input),
    calculator: (input) => calculatorTool(input),
    notes_save: (input, ctx) => notesSaveTool(notes, ctx.userId, input),
    notes_list: (input, ctx) => notesListTool(notes, ctx.userId, input),
    notes_search: (input, ctx) => notesSearchTool(notes, ctx.userId, input),
  };
}
