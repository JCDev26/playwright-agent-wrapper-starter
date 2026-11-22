import { specialists, type Specialist } from "./mailbox";
import type { ReleaseDesk } from "./release-desk";

type Worker = ReturnType<ReleaseDesk["connect"]>;
const protocol = "swarm-turn/v1";

function header(worker: Worker) {
  return { protocol, jobId: worker.jobId, revision: worker.revision, connectionId: worker.connectionId };
}

export function isSpecialist(value: unknown): value is Specialist {
  return specialists.some(s => s === value);
}

/** Transport the worker's own memory and addressed mail through any tool that reads JSON. */
export function workerBrief(worker: Worker) {
  const project = worker.project();
  const head = project.claims.candidate;
  if (typeof head !== "object" || head.value !== worker.revision || head.revision !== worker.revision) {
    throw new Error("Candidate changed; reconnect before preparing another brief.");
  }
  return {
    ...header(worker), role: worker.role, lineage: project.lineage, projectSequence: project.sequence,
    currentClaims: project.claims, outputVersions: project.versions, ownCheckpoint: worker.checkpoint() ?? null,
    receiptAtReconnect: structuredClone(worker.receipt ?? null), inbox: worker.inbox(),
    openFindings: project.findings.filter(t => t.state !== "resolved" && t.finding.revision === worker.revision
      && (t.finding.sender === worker.role || t.finding.recipients.includes(worker.role))),
    replyKinds: worker.role === "reporting" ? ["note", "finding", "acknowledged"] : ["note", "finding", "response"],
    exampleReply: { ...header(worker), messageId: "my-note-1", message: { kind: "note",
      to: worker.role === "reporting" ? "performance" : "reporting", text: "Replace with a finding or question for this peer." } },
  };
}

function record(value: unknown, fields?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || (fields && Object.keys(value).some(key => !fields.includes(key)))) throw new Error("Unrecognized worker packet fields.");
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty text in the worker packet.");
  return value;
}

function sequence(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Invalid reply sequence.");
  return value;
}

/** The operator selects the connection. An incoming proposal can only invoke its named message operations. */
export function acceptReply(worker: Worker, input: unknown) {
  const packet = record(input, ["protocol", "jobId", "revision", "connectionId", "messageId", "message"]);
  if (packet.protocol !== protocol || packet.jobId !== worker.jobId || packet.revision !== worker.revision
      || packet.connectionId !== worker.connectionId) throw new Error("Reply belongs to another protocol, job, revision or connection.");
  const id = text(packet.messageId);
  const message = record(packet.message);
  switch (message.kind) {
    case "note":
      record(message, ["kind", "to", "text"]);
      if (!isSpecialist(message.to)) throw new Error("Unknown specialist recipient.");
      return worker.note(id, message.to, text(message.text));
    case "finding": {
      record(message, ["kind", "section", "sampleIds", "text", "evidenceRef"]);
      const summary = text(message.text), evidence = text(message.evidenceRef);
      if (message.section === "suite" && message.sampleIds === undefined) {
        return worker.find(id, { section: "suite" }, summary, evidence);
      }
      if (message.section !== "timing" || !Array.isArray(message.sampleIds)) throw new Error("Unknown finding or missing timing samples.");
      return worker.find(id, { section: "timing", sampleIds: message.sampleIds.map(text) }, summary, evidence);
    }
    case "acknowledged":
      record(message, ["kind", "replyTo"]);
      return worker.acknowledgeSteer(id, sequence(message.replyTo));
    case "response": {
      record(message, ["kind", "replyTo", "disposition", "evidenceRef"]);
      const disposition = message.disposition;
      if (disposition !== "confirmed" && disposition !== "disproved" && disposition !== "investigating") {
        throw new Error("Unknown finding disposition.");
      }
      return worker.respond(id, sequence(message.replyTo), disposition, text(message.evidenceRef));
    }
    default: throw new Error("Unknown worker message kind.");
  }
}
