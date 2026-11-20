export interface DoctorCheck {
  name: string;
  category: "configuration" | "dependency" | "environment" | "capability";
  status: "passed" | "failed" | "not-checked";
  detail: string;
}
export interface DoctorResult {
  schemaVersion: 1;
  status: "ready" | "blocked";
  profile: string;
  checkedAt: string;
  checks: DoctorCheck[];
  limits: string;
}
export function runDoctor(options?: { cwd?: string; profile?: string; headed?: boolean }, deps?: {
  nodeVersion?: string;
  spawnSync?: (...args: any[]) => { status: number | null; stdout?: string; error?: Error };
}): DoctorResult;
