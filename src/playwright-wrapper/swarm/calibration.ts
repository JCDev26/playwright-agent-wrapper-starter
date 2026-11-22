import { createHash } from "node:crypto";
import { ReservationDesk } from "./reservation-retry";

const cases = Object.freeze(["north", "east", "west"] as const);
export const verdicts = ["supported", "contradicted", "inconclusive"] as const;
type CaseId = typeof cases[number];
type Verdict = typeof verdicts[number];

export const calibrationBrief = Object.freeze({
  version: "reservation-review-v1",
  claim: "In this fixture, retrying the same intended booking after losing the acknowledgment leaves exactly one booking.",
  scope: "Three independent local gateway configurations. Judge each separately.",
  evidencePolicy: "Use only the supplied observations. Each control uses a fresh desk and demonstrates a booking can reach the ledger.",
  cases,
});

/** Execute both arms of each controlled fixture. Only independent ledger observations go to the reviewers. */
export function calibrationPacket() {
  const observations = cases.map(id => {
    const control = new ReservationDesk();
    control.reserve("control", "studio");
    const desk = new ReservationDesk();
    desk.reserve("original", "studio"); // Committed; the client's acknowledgment was lost.
    desk.reserve(id === "east" ? "new-on-retry" : "original", "studio");
    return { id, observations: [
      { ref: id + "/control", observation: "Control started empty; the independent ledger counted " + control.bookingsFor("studio").length + " booking after a fresh request." },
      { ref: id + "/client", observation: "The trial started empty. The gateway returned success on the retry after the first acknowledgment was lost." },
      { ref: id + "/ledger", observation: id === "north" ? "Trial ledger read was unavailable."
        : "Independent trial ledger count after retry: " + desk.bookingsFor("studio").length + "." },
    ] };
  });
  const content = { ...calibrationBrief, observations };
  return { packetDigest: createHash("sha256").update(JSON.stringify(content)).digest("hex"), ...content };
}

interface Answer { id: CaseId; verdict: Verdict; evidence: string[]; rationale: string }
export interface Submission { reviewer: string; packetDigest: string; answers: Answer[] }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Expected a calibration record.");
  return value as Record<string, unknown>;
}

function score(input: unknown) {
  const record = object(input);
  const packet = calibrationPacket();
  if (record.packetDigest !== packet.packetDigest || typeof record.reviewer !== "string" || !record.reviewer.trim()
      || !Array.isArray(record.answers) || record.answers.length !== cases.length) throw new Error("Invalid reviewer, packet digest or case count.");
  const answers = record.answers.map(object);
  const key: Record<CaseId, Verdict> = { north: "inconclusive", east: "contradicted", west: "supported" };
  const scored = cases.map(id => {
    const rows = answers.filter(answer => answer.id === id);
    const row = rows[0];
    if (rows.length !== 1 || !row || !verdicts.includes(row.verdict as Verdict) || typeof row.rationale !== "string"
        || !row.rationale.trim() || !Array.isArray(row.evidence)
        || !row.evidence.every(ref => packet.observations.find(c => c.id === id)?.observations.some(o => o.ref === ref))) {
      throw new Error("Invalid or duplicate answer, rationale or evidence reference for " + id);
    }
    const grounded = row.evidence.includes(id + "/control") && row.evidence.includes(id + "/ledger");
    return { id, expected: key[id], actual: row.verdict as Verdict, correct: row.verdict === key[id], citedControlAndLedger: grounded };
  });
  return { reviewer: record.reviewer.trim(), cases: scored,
    correct: scored.filter(c => c.correct).length,
    correctWithRequiredCitations: scored.filter(c => c.correct && c.citedControlAndLedger).length,
    missedDefects: scored.filter(c => c.expected === "contradicted" && c.actual !== "contradicted").length,
    falseAccusationsOnSoundCases: scored.filter(c => c.expected === "supported" && c.actual === "contradicted").length,
    unsupportedDecisionsOnMissingEvidence: scored.filter(c => c.expected === "inconclusive" && c.actual !== "inconclusive").length };
}

export function compareReviews(ordinary: unknown, challenge: unknown) {
  const baseline = score(ordinary), twoPass = score(challenge);
  if (baseline.reviewer === twoPass.reviewer) throw new Error("Use two independent reviewer IDs.");
  return { packetDigest: calibrationPacket().packetDigest, baseline, twoPass,
    differenceInCorrectWithRequiredCitations: twoPass.correctWithRequiredCitations - baseline.correctWithRequiredCitations };
}
