import { serveAgent } from "../agents/transport";
import { contrarianTool, reviewVerdict } from "./reviewVerdict";

serveAgent({ role: "contrarian", tool: contrarianTool, execute: reviewVerdict,
  passingStatus: "approved", failingStatus: "failure_confirmed" });
