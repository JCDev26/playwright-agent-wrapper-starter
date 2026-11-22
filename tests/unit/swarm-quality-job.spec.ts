import { expect, test } from "@playwright/test";
import type { VerdictReview } from "../../src/playwright-wrapper/contrarian/reviewVerdict";
import { QualityJob, qualityHandoffs } from "../../src/playwright-wrapper/swarm/quality-job";
import { runQualityTask } from "../../src/playwright-wrapper/swarm/quality-tasks";

function receipt(): VerdictReview {
  return { schemaVersion: 1, policyVersion: 1, jobId: "one", revision: "a".repeat(40), status: "failure_confirmed",
    advance: false, reason: "Held", upstreamResult: "failure", reportedStatus: "failed", manifestSha256: "a".repeat(64),
    summarySha256: "c".repeat(64), planSha256: null, suite: null, confirmedFailures: ["security"],
    challenges: ["performance_baseline_unverified", "discovery_mismatch"] };
}

test("routes independent failures and missing evidence without changing the native verdict", () => {
  const source = receipt();
  const hands = qualityHandoffs(source);
  expect(hands.map(h => [h.role, h.confirmedFailures, h.challenges])).toEqual([
    ["security", ["security"], []], ["performance", [], ["performance_baseline_unverified"]], ["reporting", [], ["discovery_mismatch"]]]);
  expect(source.advance).toBe(false);
  expect(() => runQualityTask("unknown")).toThrow(/Unknown quality area/);
});

test("holds one real-job handoff, replays a private inbox, and retires old connections and evidence", () => {
  const source = receipt();
  const session = new QualityJob(() => structuredClone(source));
  const first = session.step("save reporting Inspect the native report") as { checkpointId: string };
  expect(session.step("save reporting Review incoming messages")).toMatchObject({ parentId: first.checkpointId });
  expect(session.step("history reporting")).toHaveLength(2);
  const old = session.brief("reporting").exampleReply;
  const packet = session.brief("security").exampleReply;
  session.step("hold security");
  expect(() => session.reply("security", packet)).toThrow(/held/);
  expect(session.reply("performance", session.brief("performance").exampleReply).sequence).toBe(1);
  session.step("continue security");
  expect(session.reply("security", packet).sequence).toBe(2);
  expect(session.reply("security", packet).sequence).toBe(2);
  expect(() => session.reply("security", { ...packet, text: "changed" })).toThrow(/different intent/);
  session.step("processed reporting 1");
  source.manifestSha256 = "d".repeat(64);
  expect(session.step("resume reporting")).toMatchObject({ evidenceChanged: true,
    reconciliation: expect.arrayContaining([{ source: "plan", disposition: "unverified", previous: null, latest: null },
      { source: "manifest", disposition: "historical", previous: "a".repeat(64), latest: "d".repeat(64) }]),
    current: { inbox: [{ sequence: 1 }, { sequence: 2 }] } });
  expect(() => session.reply("reporting", old)).toThrow(/stale/);
  expect(() => session.reply("security", packet)).toThrow(/stale/);
  source.status = "denied";
  expect(() => session.step("brief reporting")).toThrow(/no longer authorizes/);
});

test("refuses a native job without host bindings", () => {
  const isolated = require("node:child_process").spawnSync(process.execPath,
    ["--import", "tsx", "src/playwright-wrapper/swarm/cli.ts", "review"],
    { env: { ...process.env, PW_AGENT_JOB_ID: "" }, encoding: "utf8" });
  expect(isolated.status).toBe(2);
  expect(JSON.parse(isolated.stdout).verdict).toMatchObject({ status: "denied", advance: false });
});
