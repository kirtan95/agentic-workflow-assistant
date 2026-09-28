import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNotesStore,
  notesSaveTool,
  notesListTool,
  notesSearchTool,
} from "../src/tools/notes.js";

describe("notes (JSON fallback)", () => {
  let dir;
  let store;

  beforeEach(async () => {
    // Force the JSON fallback regardless of the host environment.
    delete process.env.DATABASE_URL;
    dir = await mkdtemp(join(tmpdir(), "notes-test-"));
    store = await createNotesStore({ dataDir: dir });
  });

  it("saves, lists and searches notes per user", async () => {
    await store.save("u1", "buy milk");
    await store.save("u1", "call the dentist");
    await store.save("u2", "u2-only note");

    const list = await store.list("u1");
    assert.equal(list.length, 2);
    assert.equal(list[0].body, "call the dentist"); // most recent first
    assert.equal(list[1].body, "buy milk");

    const found = await store.search("u1", "DENTIST");
    assert.equal(found.length, 1);
    assert.equal(found[0].body, "call the dentist");

    const none = await store.search("u1", "spaceships");
    assert.equal(none.length, 0);

    // Users are isolated from each other.
    assert.equal((await store.list("u2")).length, 1);
  });

  it("tool wrappers validate input and format output", async () => {
    const saved = await notesSaveTool(store, "u1", { text: "  remember this  " });
    assert.match(saved, /Saved note #1: remember this/);

    const listed = await notesListTool(store, "u1", {});
    assert.match(listed, /#1/);

    const searched = await notesSearchTool(store, "u1", { query: "remember" });
    assert.match(searched, /remember this/);

    await assert.rejects(
      notesSaveTool(store, "u1", { text: "   " }),
      /non-empty/,
    );
    await assert.rejects(
      notesSearchTool(store, "u1", { query: "" }),
      /non-empty/,
    );
  });

  it("persists to the JSON file so notes survive a reload", async () => {
    await store.save("u1", "persistent note");
    const reloaded = await createNotesStore({ dataDir: dir });
    const list = await reloaded.list("u1");
    assert.equal(list.length, 1);
    assert.equal(list[0].body, "persistent note");
    await rm(dir, { recursive: true, force: true });
  });
});
