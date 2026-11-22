import { EventEmitter, once } from "node:events";
import { isDeepStrictEqual } from "node:util";
import type { Lineage } from "./checkpoints";

export const specialists = ["security", "performance", "reporting"] as const;
export type Specialist = typeof specialists[number];
export type Actor = Specialist | "orchestrator";
export type Section = "timing" | "suite";

export type Concern = { section: "timing"; sampleIds: string[] } | { section: "suite" };

export type Message =
  | { kind: "note"; text: string }
  | { kind: "finding"; concern: Concern; text: string; evidenceRef: string }
  | { kind: "response"; replyTo: number; disposition: "investigating" | "confirmed" | "disproved"; evidenceRef: string }
  | { kind: "steer"; section: Section; decision: "hold" | "continue"; reason: string }
  | { kind: "acknowledged"; replyTo: number }
  | { kind: "evidence"; section: Section; evidenceRef: string; digest: string };

export interface Delivery {
  lineage: Lineage;
  runId: string;
  senderJob: string;
  sequence: number;
  timestamp: string;
  revision: string;
  sender: Actor;
  recipients: Actor[];
  messageId: string;
  body: Message;
}

/** One host log for one project lineage. Addressed delivery is independent of the conductor reading its own mailbox. */
export class Mailboxes {
  private readonly events: Delivery[] = [];
  private readonly bySenderId = new Map<string, Delivery>();
  private readonly wake = new EventEmitter();

  constructor(private readonly lineage: Lineage, private readonly runId: string, private readonly clock: () => string) {}

  get sequence() { return this.events.length; }

  after(recipient: Actor, cursor: number): Delivery[] {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.sequence) throw new Error("Invalid mailbox cursor.");
    return structuredClone(this.events.slice(cursor).filter(event => event.recipients.includes(recipient)));
  }

  sent(sender: Actor, id: string) {
    const delivery = this.bySenderId.get(JSON.stringify([sender, id]));
    return delivery ? structuredClone(delivery) : undefined;
  }

  event(sequence: number) {
    const event = this.events[sequence - 1];
    if (!event) throw new Error("Unknown message.");
    return structuredClone(event);
  }

  async wait(recipient: Actor, cursor: number, signal: AbortSignal) {
    signal.throwIfAborted();
    const ready = this.after(recipient, cursor);
    if (ready.length) return ready;
    await once(this.wake, recipient, { signal });
    return this.after(recipient, cursor);
  }

  send(sender: Actor, id: string, to: Actor[], revision: string, body: Message) {
    if (!id.trim()) throw new Error("A stable message ID is required.");
    const key = JSON.stringify([sender, id]);
    const recipients = [...new Set<Actor>([...to, "orchestrator"])].sort();
    const old = this.bySenderId.get(key);
    if (old) {
      if (old.revision !== revision || !isDeepStrictEqual(old.body, body) || !isDeepStrictEqual(old.recipients, recipients)) {
        throw new Error("Message ID reused with different intent.");
      }
      return { delivery: structuredClone(old), inserted: false };
    }
    const delivery: Delivery = { lineage: structuredClone(this.lineage), runId: this.runId, senderJob: this.runId + "/" + sender,
      sequence: this.sequence + 1, timestamp: this.clock(), revision,
      messageId: id, sender, recipients, body: structuredClone(body) };
    this.events.push(delivery);
    this.bySenderId.set(key, delivery);
    for (const recipient of recipients) this.wake.emit(recipient);
    return { delivery: structuredClone(delivery), inserted: true };
  }
}
