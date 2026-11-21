import { serveAgent } from "../agents/transport";
import { assessPerformance, tool } from "./assessPerformance";

serveAgent({ role: "performance", tool, execute: assessPerformance,
  passingStatus: "within_budget", failingStatus: "regression_reproduced" });
