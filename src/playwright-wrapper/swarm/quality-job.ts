import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { contrarianTool, reviewVerdict, type VerdictReview } from "../contrarian/reviewVerdict";
import { Mailboxes, specialists, type Specialist } from "./mailbox";
import { isSpecialist } from "./worker-port";

export const readQualityVerdict = () => reviewVerdict(contrarianTool.name, {});
function owner(area: string): Specialist {
  if (area === "security" || area.startsWith("security_")) return "security";
  if (area === "performance" || area.startsWith("performance_")) return "performance";
  return "reporting";
}

/** Routing is advisory. The reviewer's original judgment and reasons remain intact. */
export function qualityHandoffs(review: VerdictReview) {
  if (review.status === "denied" || !review.jobId || !review.revision) return [];
  return specialists.map(role => ({
    role, jobId: review.jobId, revision: review.revision,
    confirmedFailures: review.confirmedFailures.filter(area => owner(area) === role),
    challenges: review.challenges.filter(code => owner(code) === role),
  }));
}

export class QualityJob {
  private readonly mail: Mailboxes;
  private readonly first: VerdictReview;
  private readonly holds = new Set<Specialist>();
  private readonly connections = new Map<Specialist, string>();
  private readonly cursors = new Map<Specialist, number>();
  private readonly saves = new Map<Specialist, {
    checkpointId: string; parentId: string | null; nextAction: string | null; brief: ReturnType<QualityJob["brief"]>;
  }[]>();

  constructor(private readonly read: () => VerdictReview = readQualityVerdict) {
    this.first = read();
    if (!this.first.jobId || !this.first.revision || this.first.status === "denied") throw new Error(this.first.reason);
    this.mail = new Mailboxes({ repository: process.env.GITHUB_REPOSITORY ?? "local-wrapper", task: this.first.jobId,
      branch: process.env.GITHUB_REF ?? "revision/" + this.first.revision }, this.first.jobId, () => new Date().toISOString());
    for (const role of specialists) this.connections.set(role, randomUUID());
  }

  private current() {
    const now = this.read();
    if (now.status === "denied" || now.jobId !== this.first.jobId || now.revision !== this.first.revision) {
      throw new Error("The host no longer authorizes this job and revision.");
    }
    return now;
  }

  brief(role: Specialist) {
    const current = this.current();
    const evidence = createHash("sha256").update(JSON.stringify(current)).digest("hex");
    const binding = { jobId: current.jobId, revision: current.revision, connection: this.connections.get(role), evidence };
    return { role, binding, observedAt: new Date().toISOString(), verdict: current.status, held: this.holds.has(role),
      sources: { manifest: current.manifestSha256, summary: current.summarySha256, plan: current.planSha256,
        reported: current.reportedStatus, upstream: current.upstreamResult },
      assignment: qualityHandoffs(current).find(item => item.role === role)!,
      inbox: this.mail.after(role, this.cursors.get(role) ?? 0), processedThrough: this.cursors.get(role) ?? 0,
      exampleReply: { binding, id: "replace-with-a-unique-id", to: role === "reporting" ? "performance" : "reporting", text: "Your observation" } };
  }

  reply(role: Specialist, input: unknown) {
    const brief = this.brief(role);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a reply packet.");
    const packet = input as Record<string, unknown>;
    if (Object.keys(packet).length !== 4 || !isDeepStrictEqual(packet.binding, brief.binding)
        || typeof packet.id !== "string" || !packet.id.trim() || packet.id.length > 128
        || !isSpecialist(packet.to) || typeof packet.text !== "string" || !packet.text.trim() || packet.text.length > 4000) {
      throw new Error("Invalid reply or stale job, connection or evidence. Read a fresh brief.");
    }
    const sent = this.mail.sent(role, packet.id);
    if (!sent && this.holds.has(role)) throw new Error("This specialist's outgoing handoff is held.");
    return this.mail.send(role, packet.id, [packet.to], this.first.revision!, { kind: "note", text: packet.text }).delivery;
  }

  step(command: string): unknown {
    if (command === "review") {
      const verdict = this.current();
      return { verdict, handoffs: qualityHandoffs(verdict) };
    }
    const match = /^(brief|reply|hold|continue|save|history|resume|processed)\s+(\S+)(?:\s+(.+))?$/.exec(command);
    if (!match || !isSpecialist(match[2])) throw new Error("Expected a command and a registered specialist.");
    const action = match[1], role = match[2], body = match[3];
    if (action === "reply" && body) return this.reply(role, JSON.parse(body));
    if (action === "processed" && body && /^\d+$/.test(body)) {
      const next = this.brief(role).inbox[0];
      if (!next || next.sequence !== Number(body)) throw new Error("Process the next addressed message in order.");
      this.cursors.set(role, next.sequence);
      return { processedThrough: next.sequence };
    }
    if (body !== undefined && action !== "save") throw new Error("Unexpected command arguments.");
    const current = this.brief(role);
    const history = this.saves.get(role) ?? [];
    switch (action) {
      case "brief": return current;
      case "hold": this.holds.add(role); return { role, held: true };
      case "continue": this.holds.delete(role); return { role, held: false };
      case "save": {
        if (body && body.length > 4000) throw new Error("Next action exceeds packet limit.");
        const checkpoint = { checkpointId: randomUUID(), parentId: history.at(-1)?.checkpointId ?? null,
          nextAction: body ?? null, brief: current };
        history.push(checkpoint);
        this.saves.set(role, history);
        return structuredClone(checkpoint);
      }
      case "history": return structuredClone(history);
      case "resume": {
        const checkpoint = history.at(-1);
        if (!checkpoint) throw new Error("No checkpoint for this specialist.");
        const saved = checkpoint.brief;
        this.connections.set(role, randomUUID());
        this.cursors.set(role, saved.processedThrough);
        return { checkpointId: checkpoint.checkpointId, nextAction: checkpoint.nextAction,
          savedAt: saved.observedAt, evidenceChanged: current.binding.evidence !== saved.binding.evidence,
          reconciliation: Object.entries(current.sources).map(([key, latest]) => {
            const previous = saved.sources[key as keyof typeof saved.sources];
            const disposition = !latest || !previous ? "unverified" : previous === latest ? "current"
              : key === "reported" || key === "upstream" ? "contradicted" : "historical";
            return { source: key, disposition, previous, latest };
          }), previousAssignment: structuredClone(saved.assignment), current: this.brief(role) };
      }
      default: throw new Error("Missing command arguments.");
    }
  }
}
