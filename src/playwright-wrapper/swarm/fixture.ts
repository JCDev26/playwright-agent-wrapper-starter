import { CheckpointStore, reconcile, type HandoffPacket, type Lineage, type Observation, type ProjectSnapshot } from "./checkpoints";
import { ReleaseDesk } from "./release-desk";
import type { TimingCapture } from "./timing";

export const revisionA = "a".repeat(40), revisionB = "b".repeat(40);
export const mainLineage: Lineage = { repository: "example/task-board", task: "release-72", branch: "main" };
export const startTime = "2026-11-22T10:00:00.000Z";

export function observation(revision: string, value: string, evidenceRef: string, observedAt = startTime): Observation {
  return { revision, value, evidenceRef, observedAt };
}

export function initialCapture(revision: string): TimingCapture {
  return { revision, evidenceRef: "capture/1", samples: [
    { id: "17", status: 200, finalPath: "/tasks", ms: 110 },
    { id: "18", status: 200, finalPath: "/tasks", ms: 12 },
    { id: "19", status: 200, finalPath: "/tasks", ms: 120 },
  ] };
}

/** Fixture operator controls the readers. Specialist handles never receive these controls. */
export function createFixture(lineage: Lineage = mainLineage, saves = new CheckpointStore()) {
  const project: ProjectSnapshot = { lineage: structuredClone(lineage), claims: {
    candidate: observation(revisionA, revisionA, "git/A"),
    suite: observation(revisionA, "passed", "ci/A/attempt-1"),
    publishGrant: { ...observation(revisionA, "granted", "owner/grant-1"), expiresAt: "2026-11-22T11:00:00.000Z",
      grantFor: { action: "publish-fixture", lineage: structuredClone(lineage) } },
  } };
  const world = { project, capture: initialCapture(revisionA), now: startTime };
  const desk = new ReleaseDesk({ project: () => world.project, timing: () => world.capture, clock: () => world.now }, "run-8", saves);
  return { world, desk, saves };
}

export function correctedCapture(revision: string): TimingCapture {
  const capture = initialCapture(revision);
  capture.evidenceRef = "capture/2";
  capture.samples[1]!.finalPath = "/login";
  capture.samples.push({ id: "20", status: 200, finalPath: "/tasks", ms: 130 });
  return capture;
}

export type WorldChange = "unchanged" | "advanced" | "revoked" | "expired" | "unavailable" | "conflicting";
export function changeWorld(world: ReturnType<typeof createFixture>["world"], change: WorldChange) {
  const claims = world.project.claims;
  world.now = new Date(Math.max(Date.parse(world.now), Date.parse(startTime) + 300_000)).toISOString();
  switch (change) {
    case "advanced": claims.candidate = observation(revisionB, revisionB, "git/B", world.now); break;
    case "revoked": claims.publishGrant = { ...observation(revisionA, "revoked", "owner/revocation-2", world.now),
      expiresAt: "2026-11-22T11:00:00.000Z", grantFor: { action: "publish-fixture", lineage: structuredClone(world.project.lineage) } }; break;
    case "expired": world.now = "2026-11-22T11:00:00.000Z"; break;
    case "unavailable": claims.publishGrant = "unavailable"; break;
    case "conflicting": claims.publishGrant = "conflicting"; break;
    case "unchanged": break;
  }
}

export function readyReview(lineage = mainLineage, saves = new CheckpointStore()) {
  const setup = createFixture(lineage, saves);
  setup.desk.connect("performance").reviewTiming("check-1");
  const reporting = setup.desk.connect("reporting");
  for (const section of ["suite", "timing"] as const) {
    if (reporting.draft(section).submit() !== "accepted") throw new Error("Fixture failed to reach its positive control.");
  }
  for (const message of reporting.inbox()) reporting.processed(message.sequence);
  const saved = reporting.save("Ask host to publish this revision.");
  return { ...setup, reporting, saved };
}

/** Reconnect within a surviving host and compare the original memory with the designated readers. */
export function memoryExercise(change: WorldChange) {
  const { desk, world, saved, reporting } = readyReview();
  const preflight = desk.challenge(saved.checkpointId);
  reporting.disconnect();
  changeWorld(world, change);
  const resumed = desk.connect("reporting", saved.checkpointId);
  const immediate = desk.publish(saved.checkpointId);
  const successor = resumed.save("Reconcile remaining release requirements.");
  return { change, original: saved, preflight, resume: resumed.receipt, action: immediate, successor,
    afterRefresh: desk.challenge(successor.checkpointId) };
}

/** Compare a portable packet against a new fixture world without importing its cursor or calling the publisher. */
export function compareSavedMemory(packet: HandoffPacket, change: WorldChange) {
  const { desk, saved, world } = readyReview();
  if (packet.jobId !== saved.jobId) throw new Error("File belongs to a different fixture job.");
  changeWorld(world, change);
  const receipt = reconcile(packet, world.project, desk.projectCheckpoint().versions, world.now);
  return { mode: "read-only-comparison", change, recorded: packet, receipt, publisherCalls: desk.projectCheckpoint().publications.length };
}

export function correctionExercise() {
  const { desk, saved, reporting, world } = readyReview();
  const note = reporting.save("Investigate a remembered test failure.", [], {
    suite: observation(revisionA, "failed", "worker/summary", world.now),
  });
  reporting.disconnect();
  const resumed = desk.connect("reporting", note.checkpointId);
  const before = desk.publish(note.checkpointId);
  const corrected = resumed.save("Use the current native suite judgment.");
  return { initialId: saved.checkpointId, note, receipt: resumed.receipt, before, corrected, action: desk.publish(corrected.checkpointId) };
}

export function branchExercise() {
  const main = readyReview();
  const other = readyReview({ ...mainLineage, branch: "parallel" }, main.saves);
  other.world.now = "2026-11-22T10:15:00.000Z";
  const newer = other.reporting.save("Finish a different branch.");
  main.reporting.disconnect();
  const scoped = main.desk.connect("reporting");
  let rejection: string | undefined;
  try { main.desk.connect("reporting", newer.checkpointId); }
  catch (e) { rejection = e instanceof Error ? e.message : String(e); }
  return { main: main.saved, newerOtherBranch: newer, selected: scoped.receipt?.checkpointId, rejection };
}
