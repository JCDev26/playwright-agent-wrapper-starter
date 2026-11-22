import { expect, test as it } from "@playwright/test";
import { correctedCapture, readyReview } from "../../src/playwright-wrapper/swarm/fixture";
import { acceptReply, workerBrief } from "../../src/playwright-wrapper/swarm/worker-port";
import { Workshop } from "../../src/playwright-wrapper/swarm/workshop";

it("routes a serialized tool reply through the bound worker with ordered delivery and retry semantics", () => {
  const lab = new Workshop();
  const brief = lab.step("brief security") as ReturnType<typeof workerBrief>;
  expect(brief.ownCheckpoint).toBeNull();
  const packet = { ...brief.exampleReply, message: { kind: "note", to: "performance", text: "Inspect final routes." } };
  const command = "reply security " + JSON.stringify(packet);
  const sent = lab.step(command);
  expect(lab.step(command)).toEqual(sent);
  expect((lab.step("brief performance") as typeof brief).inbox.at(-1)).toEqual(sent);
  expect((lab.step("brief reporting") as typeof brief).inbox).not.toContainEqual(sent);
  expect(lab.setup.desk.transcript().at(-1)).toEqual(sent);
  expect(() => lab.step("reply security " + JSON.stringify({ ...packet, message: { ...packet.message, text: "Changed intent" } }))).toThrow(/different intent/);
});

it("rejects a borrowed job, a retired connection, and extra capabilities in a tool response", () => {
  const lab = new Workshop();
  const reporting = lab.step("brief reporting") as ReturnType<typeof workerBrief>;
  const packet = reporting.exampleReply;
  expect(reporting.ownCheckpoint).toMatchObject({ jobId: reporting.jobId, nextAction: "Ask host to publish this revision." });
  expect(() => lab.step("reply security " + JSON.stringify(packet))).toThrow(/another protocol, job, revision or connection/);
  for (const invalid of [{ ...packet, role: "orchestrator" }, { ...packet, message: { kind: "publish" } },
    { ...packet, message: { ...packet.message, grant: "approved" } }]) {
    expect(() => lab.step("reply reporting " + JSON.stringify(invalid))).toThrow(/worker/);
  }
  lab.step("hold");
  const ack = { ...packet, messageId: "seen", message: { kind: "acknowledged", replyTo: lab.setup.desk.transcript().at(-1)!.sequence } };
  expect(lab.step("reply reporting " + JSON.stringify(ack))).toMatchObject({ body: { kind: "acknowledged" } });
  expect(lab.step("submit")).toBe("held");
  lab.step("disconnect");
  lab.step("resume");
  expect(() => lab.step("reply reporting " + JSON.stringify(packet))).toThrow(/connection/);
  const fresh = lab.step("brief reporting") as typeof reporting;
  expect(fresh.jobId).toBe(reporting.jobId);
  expect(fresh.connectionId).not.toBe(reporting.connectionId);
  expect(fresh.ownCheckpoint).toEqual(reporting.ownCheckpoint);
  expect(lab.setup.desk.projectCheckpoint().publications).toHaveLength(0);
  lab.step("advance");
  expect(() => lab.step("brief reporting")).toThrow(/Candidate changed/);
});

it("lets the conductor inspect a specific external claim when two timing findings disagree", () => {
  const lab = new Workshop();
  lab.step("signal");
  const brief = lab.step("brief security") as ReturnType<typeof workerBrief>;
  const external = { ...brief.exampleReply, messageId: "only-19", message: { kind: "finding", section: "timing",
    sampleIds: ["19"], text: "Did this one redirect?", evidenceRef: "trace/19" } };
  const finding = lab.step("reply security " + JSON.stringify(external)) as { sequence: number };
  expect(() => lab.step("inspect")).toThrow(/several/);
  expect(lab.step("inspect " + finding.sequence)).toMatchObject({ result: { body: { disposition: "disproved" } } });
  expect(lab.step("inspect")).toMatchObject({ result: { body: { disposition: "confirmed" } } });
  expect(lab.setup.desk.projectCheckpoint().findings.map(f => f.state)).toEqual(["resolved", "resolved"]);
});

it("checks a tool-proposed finding and conclusion against the same native evidence as the built-in workers", () => {
  const { desk, world } = readyReview();
  const security = desk.connect("security"), performance = desk.connect("performance");
  const securityTurn = workerBrief(security).exampleReply;
  const finding = acceptReply(security, { ...securityTurn, messageId: "redirect-from-tool", message: {
    kind: "finding", section: "timing", sampleIds: ["18"], text: "Sample ended at login", evidenceRef: "route/18",
  } });
  const message = { kind: "response", replyTo: finding.sequence, disposition: "confirmed", evidenceRef: "capture/2" };
  const response = { ...workerBrief(performance).exampleReply, messageId: "verified", message };
  expect(() => acceptReply(security, { ...securityTurn, message })).toThrow(/assigned finding/);
  expect(() => acceptReply(performance, response)).toThrow(/native evidence/);
  world.capture = correctedCapture(performance.revision);
  performance.reviewTiming("check-tool-finding");
  expect(acceptReply(performance, response)).toMatchObject({ body: message });
  expect(desk.projectCheckpoint().findings[0]?.state).toBe("resolved");
});
