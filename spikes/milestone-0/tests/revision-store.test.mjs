import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RevisionStore } from "../src/revision-store.mjs";
import { SourceEditSessionManager } from "../src/source-edit-session.mjs";

test("a crash before pointer replacement preserves the prior coordinated revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-revision-"));
  const store = new RevisionStore(root);
  const initial = await store.initialize({ title: "Initial", timeline: { durationInFrames: 60 } });
  await assert.rejects(() => store.commit({
    baseRevisionId: initial.revisionId,
    project: { title: "Uncommitted", timeline: { durationInFrames: 90 } },
    command: "project.rename",
    crashBeforePointer: true,
  }), { code: "SIMULATED_CRASH" });
  const current = await store.current();
  assert.equal(current.pointer.revisionId, initial.revisionId);
  assert.equal(current.project.title, "Initial");
});

test("stale base revisions fail instead of silently rebasing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-revision-"));
  const store = new RevisionStore(root);
  await store.initialize({ title: "Initial" });
  await assert.rejects(() => store.commit({ baseRevisionId: "stale", project: { title: "Bad" }, command: "project.rename" }), { code: "STALE_REVISION" });
});

test("a crash after pointer replacement leaves the new complete revision authoritative", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-revision-post-pointer-"));
  const store = new RevisionStore(root);
  const initial = await store.initialize({schemaVersion: 1, nested: {title: "before"}});
  await assert.rejects(
    () => store.commit({baseRevisionId: initial.revisionId, project: {schemaVersion: 1, nested: {title: "after"}}, command: "edit", crashAfterPointer: true}),
    /after pointer replacement/,
  );
  const current = await store.current();
  assert.equal(current.project.nested.title, "after");
});

test("orphan recovery reports crash-before-pointer revisions without confusing ancestors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-revision-orphan-"));
  const store = new RevisionStore(root);
  const initial = await store.initialize({schemaVersion: 1});
  await assert.rejects(() => store.commit({baseRevisionId: initial.revisionId, project: {schemaVersion: 2}, command: "edit", crashBeforePointer: true}));
  const orphans = await store.findOrphans();
  assert.equal(orphans.length, 1);
  assert.match(orphans[0], /^revision-/);
});

test("stale locks can be replaced while live locks and wrong-owner release are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-revision-lock-"));
  const store = new RevisionStore(root);
  await store.initialize({schemaVersion: 1});
  await store.acquireLock({actorId: "one", ttlMs: 100, now: 1000});
  await assert.rejects(() => store.acquireLock({actorId: "two", ttlMs: 100, now: 1050}), /held by one/);
  await store.acquireLock({actorId: "two", ttlMs: 100, now: 1101});
  await assert.rejects(() => store.releaseLock("one"), /actor mismatch/);
  await store.releaseLock("two");
});

test("source edits commit through revision authority and quarantine external changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-source-edit-"));
  const sourcePath = path.join(root, "composition.tsx");
  await writeFile(sourcePath, "before");
  const store = new RevisionStore(path.join(root, "project"));
  const initial = await store.initialize({schemaVersion: 1});
  const manager = new SourceEditSessionManager({revisionStore: store, quarantineRoot: path.join(root, "quarantine")});
  const session = await manager.begin({sourcePath, baseRevisionId: initial.revisionId});
  await manager.commit({sessionId: session.id, candidateContent: "after", validate: async () => ({valid: true})});
  assert.equal(await readFile(sourcePath, "utf8"), "after");
  assert.equal((await store.current()).project.sources["composition.tsx"].content, "after");

  const second = await manager.begin({sourcePath, baseRevisionId: (await store.current()).pointer.revisionId});
  await writeFile(sourcePath, "external");
  await assert.rejects(
    () => manager.commit({sessionId: second.id, candidateContent: "candidate", validate: async () => ({valid: true})}),
    (error) => error.code === "EXTERNAL_SOURCE_CHANGE",
  );
  assert.equal(await readFile(sourcePath, "utf8"), "external");
});
