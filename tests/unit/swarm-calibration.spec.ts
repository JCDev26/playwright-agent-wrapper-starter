import { readFileSync } from "node:fs";
import { expect, test as it } from "@playwright/test";
import { calibrationBrief, calibrationPacket, compareReviews, type Submission } from "../../src/playwright-wrapper/swarm/calibration";

function pilot(): { baseline: Submission; twoPass: Submission } {
  return JSON.parse(readFileSync(require.resolve("../../examples/calibration/reservation-comparison.json"), "utf8"));
}

it("releases the brief before trial evidence and binds both reviewer submissions to the identical packet", () => {
  expect(calibrationBrief).not.toHaveProperty("observations");
  const packet = calibrationPacket();
  expect(packet).toEqual(calibrationPacket());
  expect(packet).not.toHaveProperty("key");
  const { baseline, twoPass } = pilot();
  const result = compareReviews(baseline, twoPass);
  for (const arm of [result.baseline, result.twoPass]) {
    expect(arm).toMatchObject({ correct: 3, missedDefects: 0, falseAccusationsOnSoundCases: 0, unsupportedDecisionsOnMissingEvidence: 0 });
  }
  expect(result.baseline.correctWithRequiredCitations).toBe(0);
  expect(result.twoPass.correctWithRequiredCitations).toBe(3);
});

it("separately counts missed defects, false accusations and overconfidence when the state read is unavailable", () => {
  const { baseline, twoPass } = pilot();
  for (const answer of baseline.answers) answer.verdict = answer.id === "west" ? "contradicted" : "supported";
  expect(compareReviews(baseline, twoPass).baseline).toMatchObject({ correct: 0, missedDefects: 1,
    falseAccusationsOnSoundCases: 1, unsupportedDecisionsOnMissingEvidence: 1 });
});

it("rejects wrong packets, repeated reviewer IDs, duplicate cases and cross-case citations", () => {
  const { baseline, twoPass } = pilot();
  expect(() => compareReviews({ ...baseline, packetDigest: "old" }, twoPass)).toThrow(/digest/);
  expect(() => compareReviews(baseline, { ...twoPass, reviewer: baseline.reviewer })).toThrow(/independent/);
  expect(() => compareReviews({ ...baseline, answers: [baseline.answers[0], ...baseline.answers.slice(0, 2)] }, twoPass)).toThrow(/duplicate/);
  baseline.answers[0]!.evidence = ["east/ledger"];
  expect(() => compareReviews(baseline, twoPass)).toThrow(/reference/);
});
