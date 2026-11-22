import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CheckpointStore, reconcile, sameLineage, type Claims, type Lineage, type ProjectSnapshot } from "./checkpoints";
import { Mailboxes, type Concern, type Delivery, type Section, type Specialist } from "./mailbox";
import { inspectTiming, type TimingCapture } from "./timing";

export interface ReleaseReaders {
  project(): ProjectSnapshot;
  timing(): TimingCapture | undefined;
  clock(): string;
}

const verifier = { timing: "performance", suite: "security" } as const;
const subscribers: Record<Section, Specialist[]> = { timing: ["performance", "reporting"], suite: ["security", "reporting"] };
type Resolution = "investigating" | "confirmed" | "disproved";
interface Thread { finding: Delivery; closedBy?: Delivery; checkedAgainst?: string }
interface ReportSection { version: number; revision: string; input: string; text: string }
export interface GateDecision { status: "held" | "published" | "already-published"; reasons: string[]; publisherCalls: number }

/** Trusted composition for a single fixture run. Give each worker only its bound endpoint. */
export class ReleaseDesk {
  private readonly mail: Mailboxes;
  private readonly leases = new Map<Specialist, AbortController>();
  private readonly threads = new Map<number, Thread>();
  private readonly holds = new Map<Section, Delivery>();
  private readonly sections = new Map<Section, ReportSection>();
  private readonly publications: { revision: string; checkpointId: string }[] = [];
  private readonly receipts: ReturnType<typeof reconcile>[] = [];
  private timingReview?: { version: number; atSequence: number; result: ReturnType<typeof inspectTiming> };
  private readonly lineage: Lineage;

  constructor(private readonly readers: ReleaseReaders, private readonly runId: string,
    private readonly saves = new CheckpointStore()) {
    this.lineage = structuredClone(readers.project().lineage);
    this.mail = new Mailboxes(this.lineage, runId, () => readers.clock());
  }

  private snapshot() {
    const state = this.readers.project();
    if (!sameLineage(this.lineage, state.lineage)) throw new Error("Designated reader changed project lineage.");
    return structuredClone(state);
  }

  private candidate(state = this.snapshot()) {
    const head = state.claims.candidate;
    if (typeof head !== "object" || !/^[0-9a-f]{40}$/.test(head.revision) || head.value !== head.revision) throw new Error("Candidate unavailable.");
    return head.revision;
  }

  private job(role: Specialist) { return this.runId + "/" + role; }

  private versions() {
    return { timingEvidence: this.timingReview?.version ?? 0, timingSection: this.sections.get("timing")?.version ?? 0,
      suiteSection: this.sections.get("suite")?.version ?? 0 };
  }

  private findingEvidence(finding: Delivery, state: ProjectSnapshot) {
    if (finding.body.kind !== "finding") return;
    const concern = finding.body.concern;
    if (concern.section === "suite") {
      const suite = state.claims.suite;
      if (typeof suite !== "object" || suite.revision !== finding.revision || !["passed", "failed"].includes(suite.value)) return;
      return { disposition: suite.value === "failed" ? "confirmed" : "disproved", ref: suite.evidenceRef,
        pin: JSON.stringify([suite.evidenceRef, suite.value]) };
    }
    const capture = this.readers.timing(), review = this.timingReview;
    if (!capture || !review || review.atSequence <= finding.sequence || capture.revision !== finding.revision
        || !isDeepStrictEqual(review.result, inspectTiming(capture))
        || !concern.sampleIds.every(id => capture.samples.some(sample => sample.id === id))) return;
    const offRoute = capture.samples.some(sample => concern.sampleIds.includes(sample.id) && sample.finalPath !== "/tasks");
    return { disposition: offRoute ? "confirmed" : "disproved", ref: capture.evidenceRef, pin: review.result.digest };
  }

  private threadState(thread: Thread, state: ProjectSnapshot) {
    const head = state.claims.candidate;
    if (typeof head !== "object") return "unverified";
    if (thread.finding.revision !== head.revision) return "historical";
    if (!thread.closedBy) return "pending";
    return this.findingEvidence(thread.finding, state)?.pin === thread.checkedAgainst ? "resolved" : "superseded";
  }

  private openFindings(revision: string, section: Section, state: ProjectSnapshot) {
    return [...this.threads.values()].filter(t => t.finding.revision === revision && t.finding.body.kind === "finding"
      && t.finding.body.concern.section === section && this.threadState(t, state) !== "resolved");
  }

  private held(revision: string, section: Section) {
    const steer = this.holds.get(section);
    return steer?.revision === revision && steer.body.kind === "steer" && steer.body.decision === "hold";
  }

  private sectionInput(section: Section, state: ProjectSnapshot): { stamp: string; text: string } | undefined {
    const revision = this.candidate(state);
    if (section === "suite") {
      const suite = state.claims.suite;
      if (typeof suite !== "object" || suite.revision !== revision || suite.value !== "passed") return;
      return { stamp: JSON.stringify([revision, suite.evidenceRef, suite.value]), text: "Suite passed at " + suite.evidenceRef };
    }
    const capture = this.readers.timing(), reviewed = this.timingReview;
    if (!capture || capture.revision !== revision || !reviewed || reviewed.result.medianMs === null
        || !isDeepStrictEqual(reviewed.result, inspectTiming(capture))) return;
    return { stamp: JSON.stringify([revision, reviewed.version, reviewed.result.evidenceRef]),
      text: "Three /tasks samples, median " + reviewed.result.medianMs + " ms; excluded: " + reviewed.result.excluded.join(", ") };
  }

  /** Only the host/orchestrator owns this method. A hold takes effect before a worker acknowledges it. */
  steer(id: string, section: Section, decision: "hold" | "continue", reason: string) {
    const send = this.mail.send("orchestrator", id, ["reporting"], this.candidate(), { kind: "steer", section, decision, reason });
    if (send.inserted) this.holds.set(section, structuredClone(send.delivery));
    return send.delivery;
  }

  projectCheckpoint() {
    const state = this.snapshot();
    return structuredClone({ ...state, sequence: this.mail.sequence, versions: this.versions(),
      outputs: Object.fromEntries(this.sections), timing: this.timingReview, steering: [...this.holds.values()],
      findings: [...this.threads.values()].map(t => ({ ...t, state: this.threadState(t, state) })), publications: this.publications });
  }

  transcript() { return this.mail.after("orchestrator", 0); }
  resumeReceipts() { return structuredClone(this.receipts); }

  /** Start or reconnect the same logical job. A replacement connection retires the previous writer. */
  connect(role: Specialist, checkpointId?: string) {
    const state = this.snapshot(), revision = this.candidate(state), jobId = this.job(role);
    const latest = this.saves.latest(this.lineage, jobId);
    const packet = checkpointId ? this.saves.get(checkpointId) : latest;
    if (packet && (!sameLineage(this.lineage, packet.lineage) || packet.jobId !== jobId
        || packet.checkpointId !== latest?.checkpointId || packet.projectSequence > this.mail.sequence)) {
      throw new Error("Checkpoint is outside this job, lineage, log or current branch head.");
    }
    const receipt = packet ? reconcile(packet, state, this.versions(), this.readers.clock()) : undefined;
    if (receipt) this.receipts.push(structuredClone(receipt));
    this.leases.get(role)?.abort();
    const lease = new AbortController();
    this.leases.set(role, lease);
    const guard = () => { if (lease.signal.aborted) throw new Error("Worker lease ended."); };
    const guardRevision = () => {
      guard();
      if (this.candidate() !== revision) throw new Error("Candidate changed; reconcile the job before new work.");
    };
    let cursor = packet?.processedThrough ?? 0, parentId = packet?.checkpointId ?? null;
    return {
      role, jobId, revision, receipt, connectionId: randomUUID(),
      checkpoint: () => { guard(); return this.saves.latest(this.lineage, jobId); },
      project: () => { guard(); return this.projectCheckpoint(); },
      inbox: () => { guard(); return this.mail.after(role, cursor); },
      wait: (signal?: AbortSignal) => {
        guard();
        return this.mail.wait(role, cursor, signal ? AbortSignal.any([lease.signal, signal]) : lease.signal);
      },
      processed: (seq: number) => {
        guard();
        const next = this.mail.after(role, cursor)[0];
        if (next?.sequence !== seq) throw new Error("Process addressed messages in order.");
        cursor = seq;
      },
      disconnect: () => lease.abort(),
      save: (nextAction: string, openQuestions: string[] = [], proposed: Partial<Claims> = {}) => {
        guardRevision();
        const saved = this.saves.append({ parentId, lineage: this.lineage, jobId, processedThrough: cursor,
          projectSequence: this.mail.sequence, savedAt: this.readers.clock(), claims: { ...this.snapshot().claims, ...proposed },
          outputs: this.versions(), openQuestions, nextAction });
        parentId = saved.checkpointId;
        return saved;
      },
      note: (id: string, to: Specialist, text: string) => {
        guardRevision();
        return this.mail.send(role, id, [to], revision, { kind: "note", text }).delivery;
      },
      find: (id: string, concern: Concern, text: string, evidenceRef: string, direct?: Specialist) => {
        guardRevision();
        if (!text.trim() || !evidenceRef.trim()) throw new Error("A finding needs an observation and evidence reference.");
        if (concern.section === "timing" && (!concern.sampleIds.length || concern.sampleIds.some(s => !s.trim())
            || new Set(concern.sampleIds).size !== concern.sampleIds.length)) throw new Error("Identify the samples to verify.");
        const section = concern.section;
        const to = direct ? [...subscribers[section], direct] : subscribers[section];
        const send = this.mail.send(role, id, to, revision, { kind: "finding", concern, text, evidenceRef });
        if (send.inserted) this.threads.set(send.delivery.sequence, { finding: structuredClone(send.delivery) });
        return send.delivery;
      },
      acknowledgeSteer: (id: string, seq: number) => {
        guardRevision();
        const steer = this.mail.event(seq);
        if (steer.body.kind !== "steer" || steer.revision !== revision || !steer.recipients.includes(role)) {
          throw new Error("No applicable steering instruction for this job.");
        }
        return this.mail.send(role, id, ["orchestrator"], revision, { kind: "acknowledged", replyTo: seq }).delivery;
      },
      reviewTiming: (id: string) => {
        guardRevision();
        if (role !== "performance") throw new Error("Performance owns the timing evidence.");
        const capture = this.readers.timing();
        if (!capture || capture.revision !== revision) throw new Error("No current native timing capture.");
        const result = inspectTiming(capture);
        const send = this.mail.send(role, id, subscribers.timing, revision, { kind: "evidence", section: "timing", evidenceRef: result.evidenceRef, digest: result.digest });
        if (send.inserted) this.timingReview = { version: (this.timingReview?.version ?? 0) + 1, atSequence: send.delivery.sequence, result };
        return structuredClone(result);
      },
      respond: (id: string, seq: number, disposition: Resolution, evidenceRef: string) => {
        guardRevision();
        const thread = this.threads.get(seq), finding = thread?.finding;
        if (!thread || !finding || finding.revision !== revision || finding.body.kind !== "finding"
            || verifier[finding.body.concern.section] !== role || !evidenceRef.trim()) throw new Error("Response lacks a current assigned finding.");
        const section = finding.body.concern.section;
        const send = () => this.mail.send(role, id, [...subscribers[section], finding.sender], revision,
          { kind: "response", replyTo: seq, disposition, evidenceRef }).delivery;
        if (this.mail.sent(role, id)) return send(); // Validate identical intent without repeating the effect.
        const check = this.findingEvidence(finding, this.snapshot());
        if (thread.closedBy && check && thread.checkedAgainst === check.pin) throw new Error("Finding already resolved.");
        if (disposition === "investigating") return send();
        if (!check || disposition !== check.disposition || evidenceRef !== check.ref) {
          throw new Error("Resolution disagrees with or lacks current native evidence.");
        }
        const delivery = send();
        thread.closedBy = structuredClone(delivery);
        thread.checkedAgainst = check.pin;
        return delivery;
      },
      draft: (section: Section) => {
        guardRevision();
        if (role !== "reporting") throw new Error("Reporting owns report sections.");
        const input = this.sectionInput(section, this.snapshot());
        if (!input) throw new Error("Current section evidence unavailable.");
        const version = this.sections.get(section)?.version ?? 0;
        return { section, baseVersion: version, text: input.text, submit: () => {
          guardRevision();
          if (this.held(revision, section)) return "held" as const;
          if (this.openFindings(revision, section, this.snapshot()).length) return "open-finding" as const;
          if ((this.sections.get(section)?.version ?? 0) !== version
              || this.sectionInput(section, this.snapshot())?.stamp !== input.stamp) return "stale" as const;
          this.sections.set(section, { version: version + 1, revision, input: input.stamp, text: input.text });
          return "accepted" as const;
        } };
      },
    };
  }

  /** Independent final check, repeated synchronously at the only fixture effect boundary. */
  private blockers(checkpointId: string) {
    const packet = this.saves.get(checkpointId);
    const state = this.snapshot();
    const reasons: string[] = [];
    if (!sameLineage(packet.lineage, this.lineage) || packet.jobId !== this.job("reporting")
        || this.saves.latest(this.lineage, this.job("reporting"))?.checkpointId !== checkpointId) return ["wrong-release-checkpoint"];
    const review = reconcile(packet, state, this.versions(), this.readers.clock());
    if (review.changedOutputs.length) reasons.push("report-checkpoint:outdated");
    for (const claim of review.claims) {
      if (claim.disposition !== "current") reasons.push(claim.fact + ":" + claim.disposition);
      else if (claim.fact !== "candidate" && typeof claim.latest === "object"
          && claim.latest.value !== (claim.fact === "suite" ? "passed" : "granted")) reasons.push(claim.fact + ":" + claim.latest.value);
    }
    const head = state.claims.candidate;
    if (typeof head !== "object" || head.value !== head.revision || !/^[0-9a-f]{40}$/.test(head.revision)) return reasons;
    for (const section of ["timing", "suite"] as const) {
      if (this.openFindings(head.revision, section, state).length) reasons.push(section + ":unresolved");
      if (this.held(head.revision, section)) reasons.push(section + ":held");
      const report = this.sections.get(section);
      if (!report || report.revision !== head.revision || report.input !== this.sectionInput(section, state)?.stamp) {
        reasons.push(section + ":outdated-or-missing");
      }
    }
    return reasons;
  }

  challenge(checkpointId: string) { return this.blockers(checkpointId); }

  publish(checkpointId: string): GateDecision {
    const reasons = this.blockers(checkpointId);
    if (reasons.length) return { status: "held", reasons, publisherCalls: this.publications.length };
    // All fixture readers and this effect are synchronous. No callback or await separates check from effect.
    const candidate = this.saves.get(checkpointId).claims.candidate;
    if (typeof candidate !== "object") throw new Error("Missing checked candidate.");
    if (this.publications.some(entry => entry.revision === candidate.revision)) {
      return { status: "already-published", reasons, publisherCalls: this.publications.length };
    }
    this.publications.push({ revision: candidate.revision, checkpointId });
    return { status: "published", reasons, publisherCalls: this.publications.length };
  }
}
