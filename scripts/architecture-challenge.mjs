import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const checklist = readFileSync(new URL("../examples/architecture-challenge/claim-checklist.md", import.meta.url), "utf8");
const questions = [...checklist.matchAll(/^\| (C\d\d) \| ([^|]+) \| [^|]+ \| ([^|]+) \|$/gm)]
  .map(([, id, question, probe]) => ({ id, question, probe }));
if (questions.length !== 20 || questions.some(({ id }, i) => id !== "C" + String(i + 1).padStart(2, "0"))) {
  throw new Error("Expected one checklist row for each of C01–C20.");
}

const baseline = [
  "Trace one authorized operation to its observable result through the normal entry point.",
  "Withhold required authority and observe both the enforcement decision and downstream invocation count.",
  "Compare the contributor's completion signal with an independent check of the resulting state.",
  "Remove required evidence or use evidence from another revision and inspect the resulting judgment.",
  "Where work crosses a handoff, retry or approval boundary, verify who can act next after interruption.",
];

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing " + field);
}

function plan(bytes) {
  const record = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  requireText(record.target, "target");
  requireText(record.revision, "revision");
  if (!Array.isArray(record.answers) || record.answers.length !== questions.length) {
    throw new Error("Record all twenty answers, including unknown or inapplicable items.");
  }
  const cards = questions.map(({ id, probe }) => {
    const answer = record.answers.find(item => item?.id === id);
    if (!answer || !["behavioral", "documentary", "unknown", "not-applicable"].includes(answer.kind)) {
      throw new Error("Missing or invalid answer for " + id);
    }
    requireText(answer.claim, id + " claim or reason");
    requireText(answer.basis, id + " evidence reference or search limit");
    if (!["conforms", "intentionally differs", "partially supported", "unsupported/unproven", "not applicable"].includes(answer.classification)) {
      throw new Error("Missing or invalid initial classification for " + id);
    }
    if (answer.kind !== "behavioral") {
      return { id, answer, followUp: answer.kind === "documentary" ? "Inspect the cited commitment and its scope."
        : "Record the scope or evidence limit and check whether the traced operation makes this item applicable." };
    }
    for (const field of ["entryPoint", "prediction", "observable"]) requireText(answer[field], id + " " + field);
    return { id, answer, probe,
      challenge: "At " + answer.entryPoint + ", choose a change that could falsify the quoted claim. Observe " + answer.observable + ".",
      variation: null, contraryObservation: null, positiveControl: null, controlResult: null,
      actualObservation: null, evidenceReference: null, verdict: null };
  });
  return { target: record.target, revision: record.revision,
    answersSha256: createHash("sha256").update(bytes).digest("hex"), baseline, cards };
}

try {
  const [command, file, ...extra] = process.argv.slice(2);
  let output;
  if (command === "questions" && !file) {
    output = { target: "", revision: "", answers: questions.map(({ id, question }) => ({
      id, question, kind: "", classification: "", claim: "", basis: "", entryPoint: "", prediction: "", observable: "",
    })) };
  } else if (command === "plan" && file && !extra.length) {
    output = plan(readFileSync(file));
  } else throw new Error("Usage: node scripts/architecture-challenge.mjs questions | plan answers.json");
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
