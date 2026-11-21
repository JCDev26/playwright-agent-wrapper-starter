import { record, requireEvidence } from "../reporting/pinnedEvidence";

export function requireNativeJob(report: unknown, jobId: string, revision: string) {
  const metadata = record(record(record(report).config).metadata);
  requireEvidence(metadata.agentJobId === jobId && metadata.agentRevision === revision, "native_job_mismatch");
}
