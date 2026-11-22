import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as it } from "@playwright/test";

const cli = "scripts/architecture-challenge.mjs";
function responses() {
  const sheet = JSON.parse(execFileSync(process.execPath, [cli, "questions"], { encoding: "utf8" }));
  for (const answer of sheet.answers) Object.assign(answer, {
    kind: "unknown", classification: "unsupported/unproven", claim: "Unknown", basis: "Only the public interface was inspected.",
  });
  const retry = sheet.answers.find((answer: { id: string }) => answer.id === "C13");
  Object.assign(retry, { kind: "behavioral", classification: "partially supported",
    claim: "Every retry leaves one booking.", basis: "ReservationDesk", entryPoint: "reserve",
    prediction: "One booking even with a fresh request ID.", observable: "bookingsFor(studio)" });
  return { ...sheet, target: "fixture", revision: "v1" };
}

function run(sheet: ReturnType<typeof responses>) {
  const dir = mkdtempSync(join(tmpdir(), "claim-review-"));
  try {
    const filename = join(dir, "answers.json");
    writeFileSync(filename, JSON.stringify(sheet));
    return spawnSync(process.execPath, [cli, "plan", filename], { encoding: "utf8" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

it("generates the common checklist and binds each challenge to the recorded prediction", () => {
  const sheet = responses();
  const result = run(sheet);
  expect(result.status).toBe(0);
  const plan = JSON.parse(result.stdout);
  expect(plan.answersSha256).toBe(createHash("sha256").update(JSON.stringify(sheet)).digest("hex"));
  expect(plan.cards).toHaveLength(20);
  expect(plan.baseline).toHaveLength(5);
  const retry = plan.cards[12];
  expect(retry.answer).toEqual(sheet.answers[12]);
  expect(retry.probe).toContain("safe retry");
  expect(retry.challenge).toContain("bookingsFor(studio)");
  expect(retry.verdict).toBeNull();
  expect(plan.cards[0].followUp).toContain("evidence limit");
});

it("rejects duplicate IDs and behavioral claims without an observable prediction", () => {
  const duplicate = responses();
  duplicate.answers[0] = duplicate.answers[1];
  expect(run(duplicate).status).toBe(1);
  const incomplete = responses();
  incomplete.answers[12].prediction = "";
  const result = run(incomplete);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("C13 prediction");
  expect(result.stdout).toBe("");
});
