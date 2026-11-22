import { changeWorld, correctedCapture, observation, readyReview } from "./fixture";
import type { Delivery } from "./mailbox";
import { acceptReply, isSpecialist, workerBrief } from "./worker-port";

/** Operator controls for the offline lab. Each named operation uses the normal bound role endpoint. */
export class Workshop {
  readonly setup = readyReview();
  readonly security = this.setup.desk.connect("security");
  readonly performance = this.setup.desk.connect("performance");
  private reporter = this.setup.reporting;
  private saved = this.setup.saved;
  private draft = this.reporter.draft("timing");
  private steering?: Delivery;
  private serial = 0;

  private measure(id: string) {
    this.setup.world.capture = correctedCapture(this.performance.revision);
    return this.performance.reviewTiming(id);
  }

  private inspect(sequence?: number) {
    const pending = this.setup.desk.projectCheckpoint().findings.filter(t => t.finding.revision === this.performance.revision
      && t.finding.body.kind === "finding" && t.finding.body.concern.section === "timing");
    const matches = pending.filter(t => sequence === undefined ? t.state !== "resolved" : t.finding.sequence === sequence);
    const finding = matches[0]?.finding;
    if (matches.length !== 1 || finding?.body.kind !== "finding" || finding.body.concern.section !== "timing") {
      throw new Error("Select an open timing finding. Use inspect <sequence> when several are open.");
    }
    const ids = finding.body.concern.sampleIds;
    this.performance.respond("investigate-" + finding.sequence, finding.sequence, "investigating", finding.body.evidenceRef);
    const checked = this.measure("trace-for-" + finding.sequence);
    const redirected = this.setup.world.capture.samples.some(s => ids.includes(s.id) && s.finalPath !== "/tasks");
    const result = this.performance.respond("resolution-" + finding.sequence, finding.sequence,
      redirected ? "confirmed" : "disproved", checked.evidenceRef);
    return { checked, result, explanation: "18 redirected; 19 reached /tasks. Sample 20 restores the three-sample workload." };
  }

  step(command: string): unknown {
    const { world, desk } = this.setup;
    const turn = /^(brief|reply)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(command);
    if (turn) {
      const [, operation, role, body] = turn;
      if (!isSpecialist(role)) throw new Error("Select security, performance or reporting.");
      const worker = role === "reporting" ? this.reporter : this[role];
      if (operation === "brief" && body === undefined) return workerBrief(worker);
      if (operation === "reply" && body) return acceptReply(worker, JSON.parse(body));
      throw new Error("Use brief <role> or reply <role> <JSON packet>.");
    }
    const inspection = /^inspect(?:\s+(\d+))?$/.exec(command);
    if (inspection) return this.inspect(inspection[1] === undefined ? undefined : Number(inspection[1]));
    const id = "op-" + ++this.serial;
    switch (command) {
      case "status": return desk.projectCheckpoint();
      case "events": return desk.transcript();
      case "signal":
        return this.security.find("redirect-trace", { section: "timing", sampleIds: ["18", "19"] },
          "Samples 18 and 19 may be login redirects.", "route-audit/18-19", "performance");
      case "hold":
      case "continue":
        this.steering = desk.steer(id, "timing", command, command === "hold" ? "Verify the redirect finding." : "Timing evidence ready for review.");
        return this.steering;
      case "ack":
        if (!this.steering) throw new Error("No steering instruction yet.");
        return this.reporter.acknowledgeSteer("ack-" + this.steering.sequence, this.steering.sequence);
      case "suite": return this.reporter.draft("suite").submit();
      case "measure": return this.measure(id);
      case "draft":
        this.draft = this.reporter.draft("timing");
        return { version: this.draft.baseVersion, text: this.draft.text };
      case "submit": return this.draft.submit();
      case "receive": {
        const messages = this.reporter.inbox();
        for (const message of messages) this.reporter.processed(message.sequence);
        return messages;
      }
      case "save": {
        const open = this.reporter.project().findings.filter(t => t.state !== "resolved" && t.finding.revision === this.reporter.revision);
        this.saved = this.reporter.save("Prepare release summary.", open.map(t => "Resolve finding " + t.finding.sequence));
        return this.saved;
      }
      case "disconnect":
        this.reporter.disconnect();
        return { disconnected: this.reporter.jobId, checkpointId: this.saved.checkpointId };
      case "resume":
        this.reporter = desk.connect("reporting", this.saved.checkpointId);
        const memory = this.reporter.checkpoint();
        return { jobId: this.reporter.jobId, nextAction: memory?.nextAction, openQuestions: memory?.openQuestions,
          receipt: this.reporter.receipt, waiting: this.reporter.inbox().map(e => e.sequence) };
      case "regrant": {
        const head = world.project.claims.candidate;
        if (typeof head !== "object") throw new Error("No candidate to authorize.");
        world.project.claims.publishGrant = { ...observation(head.revision, "granted", "owner/" + id, world.now),
          expiresAt: new Date(Date.parse(world.now) + 3_600_000).toISOString(),
          grantFor: { action: "publish-fixture", lineage: structuredClone(world.project.lineage) } };
        return structuredClone(world.project.claims.publishGrant);
      }
      case "revoke": changeWorld(world, "revoked"); return world.project.claims.publishGrant;
      case "expire": changeWorld(world, "expired"); return world.now;
      case "advance": changeWorld(world, "advanced"); return world.project.claims.candidate;
      case "unavailable": changeWorld(world, "unavailable"); return world.project.claims.publishGrant;
      case "gate": return desk.challenge(this.saved.checkpointId);
      case "publish": return desk.publish(this.saved.checkpointId);
      default: throw new Error("Unknown command. Enter help to see the workshop commands.");
    }
  }
}

export const workshopHelp = [
  "status / events       inspect shared project state or ordered message deliveries",
  "brief <role> / reply <role> <JSON> / reply-file <role> <path>   exchange a tool-neutral worker turn",
  "signal / inspect [sequence]   Security raises a finding; Performance verifies the selected timing claim",
  "measure               read the corrected native capture before replying to a finding yourself",
  "hold / ack / continue steer the timing decision and observe Reporting's acknowledgment",
  "suite / draft / submit accept the independent suite section, draft or submit timing",
  "receive / save / disconnect / resume   process the mailbox or reconnect the same job",
  "revoke / regrant / expire / advance / unavailable   operator changes authoritative facts",
  "gate / publish        inspect blockers or call the local fixture publisher",
  "reset / quit          start a fresh fixture or leave",
];

/** Interleave a real suspended Promise with messages and unrelated work; no sleeps or external service. */
export async function swarmExercise() {
  const lab = new Workshop();
  const steps: { action: string; result: unknown }[] = [];
  const record = (action: string, result: unknown) => steps.push({ action, result });
  const step = (action: string) => record(action, lab.step(action));
  for (const event of lab.performance.inbox()) lab.performance.processed(event.sequence);
  const waiting = lab.performance.wait();
  let finishTool!: () => void;
  const inFlight = new Promise<void>(resolve => { finishTool = resolve; }).then(() => lab.step("submit"));
  const before = lab.setup.desk.projectCheckpoint();
  step("signal");
  const delivered = await waiting;
  record("idle-performance-woke", delivered.map(m => m.sequence));
  step("hold");
  step("suite"); // Useful work proceeds while the timing draft is in flight.
  finishTool();
  record("in-flight-draft-at-submit-boundary", await inFlight);
  step("ack");
  step("receive");
  step("save");
  step("inspect");
  step("continue");
  record("old-draft-after-steering-lifted", lab.step("submit"));
  step("disconnect");
  record("direct-handoff-while-reporting-offline", lab.performance.note("summary-handoff", "reporting",
    "Use capture/2. Sample 19 remained valid and sample 20 replaced 18."));
  step("resume");
  step("receive");
  step("draft");
  step("submit");
  step("save");
  step("gate");
  step("publish");
  step("publish");
  return { before, steps, after: lab.setup.desk.projectCheckpoint(), events: lab.setup.desk.transcript() };
}
