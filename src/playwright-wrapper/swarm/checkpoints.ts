/** Contract for one release-review exercise. Only the host chooses the readers of these facts. */
export interface Lineage {
  repository: string;
  task: string;
  branch: string;
}

export const facts = ["candidate", "suite", "publishGrant"] as const;
export type Fact = typeof facts[number];

export interface Observation {
  revision: string;
  value: string;
  evidenceRef: string;
  observedAt: string;
  expiresAt?: string;
  grantFor?: { lineage: Lineage; action: string };
}
export type Reading = Observation | "unavailable" | "conflicting";
export type Claims = Record<Fact, Reading>;

export interface ProjectSnapshot {
  lineage: Lineage;
  claims: Claims;
}

export interface OutputVersions { timingEvidence: number; timingSection: number; suiteSection: number }

export interface HandoffPacket {
  schemaVersion: 1;
  checkpointId: string;
  parentId: string | null;
  lineage: Lineage;
  jobId: string;
  savedAt: string;
  processedThrough: number;
  projectSequence: number;
  outputs: OutputVersions;
  claims: Claims;
  openQuestions: string[];
  nextAction: string;
}

/** Validate the file format for read-only comparison. Reading a file cannot insert it in a host history. */
export function parseHandoff(text: string): HandoffPacket {
  return validatePacket(JSON.parse(text.replace(/^\uFEFF/, "")));
}

function validatePacket(input: unknown): HandoffPacket {
  const packet = input as Partial<HandoffPacket> | null;
  const textField = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const counter = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const scope = (v: Lineage | undefined) => v && [v.repository, v.task, v.branch].every(textField);
  if (packet?.schemaVersion !== 1 || !scope(packet.lineage) || !textField(packet.checkpointId)
      || !textField(packet.jobId) || !(packet.parentId === null || textField(packet.parentId))
      || !textField(packet.nextAction) || typeof packet.savedAt !== "string" || !Number.isFinite(Date.parse(packet.savedAt))
      || !Array.isArray(packet.openQuestions) || !packet.openQuestions.every(textField)
      || !counter(packet.projectSequence) || !counter(packet.processedThrough) || packet.processedThrough! > packet.projectSequence!
      || !packet.outputs || ![packet.outputs.timingEvidence, packet.outputs.timingSection, packet.outputs.suiteSection].every(counter)) {
    throw new Error("Invalid handoff header, cursor or output versions.");
  }
  for (const fact of facts) {
    const value = packet.claims?.[fact];
    if (value === "unavailable" || value === "conflicting") continue;
    if (!value || typeof value !== "object" || typeof value.revision !== "string" || !/^[a-f0-9]{40}$/.test(value.revision)
        || ![value.value, value.evidenceRef, value.observedAt].every(textField)
        || !Number.isFinite(Date.parse(value.observedAt))
        || (value.expiresAt !== undefined && (!textField(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt))))
        || (value.grantFor !== undefined && (!value.grantFor || !scope(value.grantFor.lineage) || !textField(value.grantFor.action)))) {
      throw new Error("Invalid handoff observation for " + fact);
    }
  }
  return packet as HandoffPacket;
}

type Disposition = "current" | "historical" | "contradicted" | "unverified";
export interface ClaimReview {
  fact: Fact;
  disposition: Disposition;
  reason: string;
  saved: Reading;
  latest: Reading;
}

export function sameLineage(a: Lineage, b: Lineage): boolean {
  return a.repository === b.repository && a.task === b.task && a.branch === b.branch;
}

function usable(reading: Reading, now: number): reading is Observation {
  return typeof reading === "object" && /^[0-9a-f]{40}$/.test(reading.revision)
    && !!reading.value && !!reading.evidenceRef && Date.parse(reading.observedAt) <= now;
}

function reviewFact(fact: Fact, saved: Reading, latest: Reading, head: Reading, lineage: Lineage, now: number): ClaimReview {
  function result(disposition: Disposition, reason: string): ClaimReview {
    return { fact, disposition, reason, saved, latest };
  }
  if (!usable(head, now) || head.value !== head.revision || !usable(saved, now)) {
    return result("unverified", "Candidate or saved observation unavailable, conflicting or invalid.");
  }
  if (saved.revision !== head.revision) return result("historical", "The claim belongs to an earlier candidate.");
  if (!usable(latest, now) || latest.revision !== head.revision) {
    return result("unverified", "No authoritative observation for this candidate.");
  }
  if (fact === "publishGrant" && [saved, latest].some(o => o.grantFor?.action !== "publish-fixture"
      || !sameLineage(o.grantFor.lineage, lineage))) return result("unverified", "No grant for this action and lineage.");
  if (saved.value !== latest.value) return result("contradicted", "The designated source reports a different value.");
  if (saved.evidenceRef !== latest.evidenceRef || saved.expiresAt !== latest.expiresAt) {
    return result("historical", "The designated source superseded the recorded evidence.");
  }
  if (fact === "publishGrant" && !latest.expiresAt) return result("unverified", "The release grant has no expiry.");
  if (latest.expiresAt !== undefined) {
    const expiry = Date.parse(latest.expiresAt);
    if (!Number.isFinite(expiry)) return result("unverified", "Invalid expiry.");
    if (now >= expiry) return result("historical", "The observation expired.");
  }
  return result("current", "Confirmed for this candidate by the designated source.");
}

export function reconcile(packet: HandoffPacket, snapshot: ProjectSnapshot, outputs: OutputVersions, checkedAt: string) {
  if (!sameLineage(packet.lineage, snapshot.lineage)) throw new Error("Checkpoint lineage mismatch.");
  const now = Date.parse(checkedAt);
  if (!Number.isFinite(now)) throw new Error("Invalid host clock.");
  const changedOutputs = (["timingEvidence", "timingSection", "suiteSection"] as const)
    .filter(name => packet.outputs[name] !== outputs[name]);
  return structuredClone({ checkpointId: packet.checkpointId, jobId: packet.jobId, checkedAt, changedOutputs,
    claims: facts.map(fact => reviewFact(fact, packet.claims[fact], snapshot.claims[fact], snapshot.claims.candidate, packet.lineage, now)) });
}

/** Host-owned history. Readers get copies and each writer advances exactly its own head. */
export class CheckpointStore {
  private readonly packets = new Map<string, HandoffPacket>();
  private readonly heads = new Map<string, string>();

  private key(lineage: Lineage, jobId: string) {
    return JSON.stringify([lineage.repository, lineage.task, lineage.branch, jobId]);
  }

  latest(lineage: Lineage, jobId: string) {
    const id = this.heads.get(this.key(lineage, jobId));
    return id ? this.get(id) : undefined;
  }

  get(id: string) {
    const packet = this.packets.get(id);
    if (!packet) throw new Error("Unknown checkpoint.");
    return structuredClone(packet);
  }

  append(input: Omit<HandoffPacket, "checkpointId" | "schemaVersion">) {
    const key = this.key(input.lineage, input.jobId);
    if ((this.heads.get(key) ?? null) !== input.parentId) throw new Error("Checkpoint head changed.");
    if (input.parentId) {
      const parent = this.get(input.parentId);
      if (input.processedThrough < parent.processedThrough || input.projectSequence < parent.projectSequence) {
        throw new Error("Checkpoint would rewind the event cursor.");
      }
    }
    const packet = validatePacket({ ...structuredClone(input), schemaVersion: 1, checkpointId: "save-" + (this.packets.size + 1) });
    this.packets.set(packet.checkpointId, packet);
    this.heads.set(key, packet.checkpointId);
    return structuredClone(packet);
  }
}
