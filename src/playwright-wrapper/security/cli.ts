import { serveAgent } from "../agents/transport";
import { assessSecurity, securityTool } from "./assessSecurity";

serveAgent({ role: "security", tool: securityTool, execute: assessSecurity,
  passingStatus: "checks_passed", failingStatus: "checks_failed" });
