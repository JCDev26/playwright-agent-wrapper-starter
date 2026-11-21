import { serveAgent } from "../agents/transport";
import { reportingTool, summarizeEvidence } from "./summarizeEvidence";

serveAgent({ role: "reporting", tool: reportingTool, execute: summarizeEvidence,
  passingStatus: "passed", failingStatus: "failed" });
