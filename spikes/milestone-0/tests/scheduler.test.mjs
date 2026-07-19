import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicFixtureAdapter, MasterScheduler } from "../src/master-scheduler.mjs";

test("repeated seeks produce identical engine artifact identities", async () => {
  const scheduler = new MasterScheduler([
    new DeterministicFixtureAdapter("remotion", "remotion-4.0.489"),
    new DeterministicFixtureAdapter("hyperframes", "hyperframes-0.7.58"),
  ]);
  const first = await scheduler.seek(42n);
  const second = await scheduler.seek(42n);
  assert.deepEqual(first.layers.map((layer) => layer.artifactIdentity), second.layers.map((layer) => layer.artifactIdentity));
  assert.equal(scheduler.masterFrame, 42n);
});

test("rejects an adapter that presents the wrong frame", async () => {
  const scheduler = new MasterScheduler([{ presentFrame: async ({ frame }) => ({ adapterId: "bad", frame: frame + 1n, ready: true }) }]);
  await assert.rejects(() => scheduler.seek(8n), /presented 9 instead of 8/);
});

test("play, pause, frame-step, and half-open loop remain scheduler-owned", async () => {
  const scheduler = new MasterScheduler([
    new DeterministicFixtureAdapter("remotion", "r"),
    new DeterministicFixtureAdapter("hyperframes", "h"),
  ]);
  await scheduler.seek(9n);
  scheduler.setLoop(10n, 13n);
  await scheduler.play();
  assert.equal(scheduler.state, "playing");
  assert.equal((await scheduler.advance(1n)).frame, 10n);
  assert.equal((await scheduler.advance(3n)).frame, 10n);
  await scheduler.pause();
  assert.equal((await scheduler.advance(1n)).advanced, false);
  assert.equal((await scheduler.step(2n)).frame, 12n);
  assert.equal((await scheduler.step(-20n)).frame, 0n);
});

test("drift diagnostics trigger an atomic hard resync", async () => {
  const scheduler = new MasterScheduler([
    new DeterministicFixtureAdapter("remotion", "r"),
    new DeterministicFixtureAdapter("hyperframes", "h"),
  ]);
  await scheduler.seek(120n);
  const result = await scheduler.hardResynchronize([
    {adapterId: "remotion", frame: 120n},
    {adapterId: "hyperframes", frame: 121n},
  ]);
  assert.equal(result.resynchronized, true);
  assert.equal(result.presentation.frame, 120n);
  assert.equal(result.report[1].deltaFrames, 1n);
});

test("ten-minute NTSC playback remains frame-aligned under one discrete master clock", async () => {
  const scheduler = new MasterScheduler([
    new DeterministicFixtureAdapter("remotion", "r"),
    new DeterministicFixtureAdapter("hyperframes", "h"),
  ]);
  await scheduler.play();
  for (let frame = 0; frame < 17982; frame += 1) await scheduler.advance(1n);
  await scheduler.pause();
  assert.equal(scheduler.masterFrame, 17982n);
  const report = scheduler.driftReport([{adapterId: "remotion", frame: 17982n}, {adapterId: "hyperframes", frame: 17982n}]);
  assert.equal(report.every((item) => item.deltaFrames === 0n), true);
});
