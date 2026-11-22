import { expect, test as it } from "@playwright/test";
import { correctedCapture, readyReview, revisionA } from "../../src/playwright-wrapper/swarm/fixture";
import { swarmExercise, Workshop } from "../../src/playwright-wrapper/swarm/workshop";

it("delivers during a running job, holds only timing, rejects an outdated draft and publishes the refreshed report", async () => {
  const { before, after, events, steps } = await swarmExercise();
  const result = (name: string) => steps.find(step => step.action === name)?.result;
  expect(result("idle-performance-woke")).toEqual([2]);
  expect(result("in-flight-draft-at-submit-boundary")).toBe("held");
  expect(result("suite")).toBe("accepted");
  expect(result("old-draft-after-steering-lifted")).toBe("stale");
  expect(result("resume")).toMatchObject({ jobId: "run-8/reporting", receipt: { changedOutputs: ["timingEvidence"] } });
  expect(result("inspect")).toMatchObject({ checked: { accepted: ["17", "19", "20"], excluded: ["18"], medianMs: 120 } });
  expect(steps.filter(s => s.action === "publish").map(s => s.result)).toEqual([
    { status: "published", reasons: [], publisherCalls: 1 }, { status: "already-published", reasons: [], publisherCalls: 1 },
  ]);
  expect(after.publications).toHaveLength(1);
  expect(after.outputs.suite?.version).toBe(before.outputs.suite!.version + 1);
  expect(after.outputs.timing?.text).toContain("120 ms");
  expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i + 1));
  expect(events.find(e => e.body.kind === "acknowledged")?.sequence).toBeGreaterThan(events.find(e => e.body.kind === "steer")!.sequence);
});

it("lets the conductor steer with no permission to close a finding by changing the hold", () => {
  const lab = new Workshop();
  lab.step("signal");
  lab.step("hold");
  lab.step("continue");
  expect(lab.step("publish")).toMatchObject({ reasons: ["timing:unresolved"], publisherCalls: 0 });
  expect(lab.step("submit")).toBe("open-finding");
  lab.step("inspect");
  expect(lab.step("submit")).toBe("stale");
  lab.step("draft");
  expect(lab.step("submit")).toBe("accepted");
  expect(lab.step("publish")).toMatchObject({ reasons: ["report-checkpoint:outdated"], publisherCalls: 0 });
  lab.step("save");
  expect(lab.step("publish")).toMatchObject({ status: "published" });
});

it("replays the addressed mailbox from a processed cursor and deduplicates delivery independently of resolution", async () => {
  const { desk } = readyReview();
  const sender = desk.connect("security"), listener = desk.connect("reporting"), perf = desk.connect("performance");
  const checkpoint = listener.save("listen");
  listener.disconnect();
  const first = sender.note("note-1", "reporting", "Recheck the route.");
  const retry = sender.note("note-1", "reporting", "Recheck the route.");
  expect(retry.sequence).toBe(first.sequence);
  expect(() => sender.note("note-1", "reporting", "Different intent")).toThrow(/different intent/);
  expect(desk.transcript().filter(e => e.messageId === "note-1")).toHaveLength(1);
  expect(perf.inbox().some(e => e.sequence === first.sequence)).toBe(false);
  const back = desk.connect("reporting", checkpoint.checkpointId);
  expect(back.jobId).toBe(listener.jobId);
  const original = await back.wait();
  expect(original[0]).toMatchObject({ senderJob: "run-8/security", revision: revisionA, body: { kind: "note" } });
  original[0]!.recipients.length = 0;
  expect(back.inbox()[0]?.recipients).toContain("reporting");
  expect(() => back.processed(first.sequence + 1)).toThrow(/in order/);
  back.processed(first.sequence);
  const later = back.save("caught up");
  expect(later.processedThrough).toBe(first.sequence);
  expect(desk.connect("reporting", later.checkpointId).inbox()).toEqual([]);
});

it("wakes or aborts a waiter when a message, caller cancellation or replacement lease arrives", async () => {
  const { desk } = readyReview();
  const worker = desk.connect("reporting");
  const controller = new AbortController();
  const waiting = worker.wait(controller.signal);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  const replacement = worker.wait();
  const next = desk.connect("reporting");
  await expect(replacement).rejects.toMatchObject({ name: "AbortError" });
  const fresh = next.wait();
  desk.connect("security").note("context", "reporting", "An update for this section");
  expect((await fresh)[0]?.messageId).toBe("context");
});

it("checks output ownership, writer replacement, revision and same-section version at commit", () => {
  const { desk, reporting, world } = readyReview();
  const security = desk.connect("security");
  expect(() => security.draft("timing")).toThrow(/Reporting owns/);
  expect(() => security.reviewTiming("x")).toThrow(/Performance owns/);
  const a = reporting.draft("timing"), b = reporting.draft("timing");
  expect(reporting.draft("suite").submit()).toBe("accepted");
  expect(a.submit()).toBe("accepted");
  expect(b.submit()).toBe("stale");
  const oldLease = reporting.draft("timing");
  const successor = desk.connect("reporting");
  expect(() => oldLease.submit()).toThrow(/lease ended/);
  const oldRevision = successor.draft("timing");
  world.project.claims.candidate = { revision: "b".repeat(40), value: "b".repeat(40), evidenceRef: "git/B", observedAt: world.now };
  expect(() => oldRevision.submit()).toThrow(/Candidate changed/);
});

it("requires the designated verifier, a real post-finding observation and the correct native conclusion", () => {
  const { desk, world, saved } = readyReview();
  const security = desk.connect("security"), perf = desk.connect("performance");
  const f = security.find("redirect", { section: "timing", sampleIds: ["18"] }, "Check final route", "audit/18");
  if (f.body.kind === "finding") f.body.text = "mutated";
  expect(desk.projectCheckpoint().findings[0]?.finding.body).toMatchObject({ text: "Check final route" });
  expect(() => security.respond("self", f.sequence, "confirmed", "capture/1")).toThrow(/assigned finding/);
  expect(() => perf.respond("guess", f.sequence, "confirmed", "capture/1")).toThrow(/native evidence/);
  world.capture = correctedCapture(revisionA);
  perf.reviewTiming("measure-2");
  expect(() => perf.respond("guess", f.sequence, "disproved", "capture/2")).toThrow(/native evidence/);
  const result = perf.respond("confirm", f.sequence, "confirmed", "capture/2");
  expect(perf.respond("confirm", f.sequence, "confirmed", "capture/2")).toEqual(result);
  expect(desk.challenge(saved.checkpointId)).not.toContain("timing:unresolved");
  // The same label alone is insufficient. An actual change to the read-back capture reopens the finding.
  world.capture.samples[1]!.finalPath = "/tasks";
  world.capture.samples.pop();
  expect(desk.challenge(saved.checkpointId)).toContain("timing:unresolved");
  perf.reviewTiming("measure-3");
  expect(() => perf.respond("stale", f.sequence, "confirmed", "capture/2")).toThrow(/native evidence/);
  perf.respond("corrected", f.sequence, "disproved", "capture/2");
  expect(desk.challenge(saved.checkpointId)).not.toContain("timing:unresolved");
});

it("keeps separate findings open and allows an observed redirect to be confirmed even when the workload is incomplete", () => {
  const { desk, world, saved } = readyReview();
  const security = desk.connect("security"), perf = desk.connect("performance");
  const present = security.find("one", { section: "timing", sampleIds: ["18"] }, "Check 18", "trace/18");
  const absent = security.find("two", { section: "timing", sampleIds: ["missing"] }, "Check another sample", "trace/missing");
  world.capture = correctedCapture(revisionA);
  world.capture.samples.pop();
  expect(perf.reviewTiming("observe").medianMs).toBeNull();
  perf.respond("confirmed", present.sequence, "confirmed", "capture/2");
  expect(() => perf.respond("assume", absent.sequence, "disproved", "capture/2")).toThrow(/native evidence/);
  expect(desk.challenge(saved.checkpointId)).toEqual(expect.arrayContaining(["timing:unresolved", "timing:outdated-or-missing"]));
});
