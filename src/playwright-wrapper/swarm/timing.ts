import { createHash } from "node:crypto";

export interface TimingCapture {
  revision: string;
  evidenceRef: string;
  samples: { id: string; status: number; finalPath: string; ms: number }[];
}

/** Three successful observations of the actual /tasks page form the fixture workload. */
export function inspectTiming(capture: TimingCapture) {
  const ids = capture.samples.map(s => s.id);
  if (!capture.evidenceRef.trim() || new Set(ids).size !== ids.length
      || capture.samples.some(s => !s.id || !Number.isFinite(s.ms) || s.ms < 0)) throw new Error("Invalid timing capture.");
  const accepted = capture.samples.filter(s => s.status === 200 && s.finalPath === "/tasks");
  const excluded = capture.samples.filter(s => s.status !== 200 || s.finalPath !== "/tasks");
  const values = accepted.map(s => s.ms).sort((a, b) => a - b);
  return { evidenceRef: capture.evidenceRef, revision: capture.revision,
    digest: createHash("sha256").update(JSON.stringify(capture)).digest("hex"),
    accepted: accepted.map(s => s.id), excluded: excluded.map(s => s.id),
    medianMs: values.length === 3 ? values[1]! : null };
}
