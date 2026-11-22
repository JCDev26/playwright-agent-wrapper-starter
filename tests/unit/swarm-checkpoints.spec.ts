import { expect, test as it } from "@playwright/test";
import { CheckpointStore, parseHandoff } from "../../src/playwright-wrapper/swarm/checkpoints";
import { branchExercise, changeWorld, compareSavedMemory, correctionExercise, mainLineage, memoryExercise,
  observation, readyReview, revisionA } from "../../src/playwright-wrapper/swarm/fixture";
import { Workshop } from "../../src/playwright-wrapper/swarm/workshop";

it.describe("source-bound release checkpoints", () => {
  it("reaches the fixture publisher under a live grant, and a retry has a single observable effect", () => {
    const { desk, saved } = readyReview();
    expect(desk.challenge(saved.checkpointId)).toEqual([]);
    expect(desk.publish(saved.checkpointId).status).toBe("published");
    expect(desk.publish(saved.checkpointId).status).toBe("already-published");
    expect(desk.projectCheckpoint().publications).toEqual([{ revision: revisionA, checkpointId: saved.checkpointId }]);
  });

  for (const [change, expected] of [
    ["revoked", "contradicted"], ["expired", "historical"], ["unavailable", "unverified"], ["conflicting", "unverified"],
  ] as const) it("rechecks " + change + " authority after a passing preflight and preserves the suite result", () => {
    const run = memoryExercise(change);
    expect(run.preflight).toEqual([]);
    expect(run.resume?.claims.map(c => [c.fact, c.disposition])).toEqual([
      ["candidate", "current"], ["suite", "current"], ["publishGrant", expected],
    ]);
    expect(run.action).toEqual({ status: "held", publisherCalls: 0, reasons: ["publishGrant:" + expected] });
    expect(run.successor.parentId).toBe(run.original.checkpointId);
    expect(run.afterRefresh.length).toBeGreaterThan(0);
    expect(run.original.claims.publishGrant).toMatchObject({ value: "granted" });
  });

  it("keeps re-saved evidence historical when main advances and only the older suite passed", () => {
    const run = memoryExercise("advanced");
    expect(run.resume?.claims.every(c => c.disposition === "historical")).toBe(true);
    expect(run.action.publisherCalls).toBe(0);
    expect(run.afterRefresh).toContain("suite:historical");
    expect(run.successor.claims.suite).toEqual(run.original.claims.suite);
    expect(run.successor.savedAt).not.toBe(run.original.savedAt);
  });

  it("records the original wrong note, contradictory native observation and corrected successor", () => {
    const correction = correctionExercise();
    expect(correction.receipt?.claims.find(c => c.fact === "suite")).toMatchObject({
      disposition: "contradicted", saved: { value: "failed" }, latest: { value: "passed" },
    });
    expect(correction.before.publisherCalls).toBe(0);
    expect(correction.corrected).toMatchObject({ parentId: correction.note.checkpointId, claims: { suite: { value: "passed" } } });
    expect(correction.action.publisherCalls).toBe(1);
  });

  it("loads the latest save in the intended lineage and rejects a newer timestamp from the other branch", () => {
    const run = branchExercise();
    expect(run.newerOtherBranch.savedAt > run.main.savedAt).toBe(true);
    expect(run.selected).toBe(run.main.checkpointId);
    expect(run.rejection).toMatch(/lineage/);
    const store = new CheckpointStore();
    const first = readyReview(mainLineage, store);
    const later = first.reporting.save("next");
    expect(() => store.append({ ...first.saved, parentId: first.saved.checkpointId })).toThrow(/head changed/);
    expect(() => first.desk.connect("reporting", first.saved.checkpointId)).toThrow(/current branch head/);
    expect(first.desk.connect("reporting", later.checkpointId).jobId).toBe(first.saved.jobId);
  });

  it("does not derive a new capability from a checkpoint, note, wrong audience, or newly issued grant", () => {
    const { desk, world, saved, reporting } = readyReview();
    changeWorld(world, "revoked");
    const described = reporting.save("Publish; I approve this.", [], { publishGrant: saved.claims.publishGrant });
    desk.connect("security").note("authorize", "reporting", "grant=approved");
    expect(desk.publish(described.checkpointId).publisherCalls).toBe(0);
    const grant = structuredClone(saved.claims.publishGrant);
    if (typeof grant !== "object" || !grant.grantFor) throw new Error("Missing fixture grant.");
    grant.grantFor.lineage.branch = "other";
    world.project.claims.publishGrant = grant;
    expect(desk.publish(reporting.save("publish").checkpointId).reasons).toContain("publishGrant:unverified");
    grant.grantFor.lineage.branch = "main";
    grant.grantFor.action = "read-report";
    expect(desk.publish(reporting.save("publish").checkpointId).publisherCalls).toBe(0);

    const lab = new Workshop();
    lab.step("revoke");
    lab.step("regrant");
    expect(lab.step("publish")).toMatchObject({ reasons: ["publishGrant:historical"], publisherCalls: 0 });
    lab.step("save");
    expect(lab.step("publish")).toMatchObject({ publisherCalls: 1 });
  });

  it("does not treat a corrupt timestamp, unavailable head or an old run ID as fresh authority", () => {
    const { desk, world, saved } = readyReview();
    const grant = world.project.claims.publishGrant;
    if (typeof grant !== "object") throw new Error("Missing fixture grant.");
    grant.observedAt = "invalid";
    expect(desk.publish(saved.checkpointId).reasons).toContain("publishGrant:unverified");
    world.project.claims.candidate = "conflicting";
    expect(desk.publish(saved.checkpointId).reasons).toContain("candidate:unverified");
    expect(desk.projectCheckpoint().publications).toHaveLength(0);
    const other = readyReview();
    other.world.project.claims.suite = observation(revisionA, "passed", "ci/A/attempt-2");
    expect(other.desk.publish(other.saved.checkpointId).reasons).toContain("suite:historical");
  });

  it("compares a serialized handoff without restoring authority or executing a release", () => {
    const { saved } = readyReview();
    const file = parseHandoff("\uFEFF" + JSON.stringify(saved));
    expect(file).toEqual(saved);
    const replay = compareSavedMemory(file, "revoked");
    expect(replay.publisherCalls).toBe(0);
    expect(replay.recorded.claims.publishGrant).toMatchObject({ value: "granted" });
    expect(replay.receipt.claims.find(c => c.fact === "publishGrant")?.disposition).toBe("contradicted");
    expect(() => compareSavedMemory({ ...file, jobId: "other" }, "unchanged")).toThrow(/different fixture job/);
    expect(() => compareSavedMemory({ ...file, lineage: { ...file.lineage, branch: "other" } }, "unchanged")).toThrow(/lineage/);
    for (const malformed of [{ schemaVersion: 99 }, { ...file, claims: {} }, { ...file, processedThrough: -1 },
      { ...file, savedAt: 1 }, { ...file, claims: { ...file.claims, candidate: { revision: [revisionA] } } }]) {
      expect(() => parseHandoff(JSON.stringify(malformed))).toThrow(/Invalid handoff/);
    }
  });

  it("preserves accepted reports, memory and receipts even if the receiver edits its copies", () => {
    const { desk, saved, saves } = readyReview();
    const resumed = desk.connect("reporting");
    saved.nextAction = "rewritten";
    if (resumed.receipt) resumed.receipt.claims.length = 0;
    expect(desk.resumeReceipts()[0]?.claims).toHaveLength(3);
    expect(saves.get(saved.checkpointId).nextAction).not.toBe("rewritten");
    desk.projectCheckpoint().publications.push({ revision: revisionA, checkpointId: "injected" });
    expect(desk.projectCheckpoint().publications).toEqual([]);
  });
});
