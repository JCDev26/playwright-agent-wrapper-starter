import { readFileSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { assessPerformance, tool } from "./assessPerformance";

process.chdir(path.resolve(__dirname, "../../.."));
async function main() {
  const flags = process.argv.slice(2);
  if (flags.length === 1 && flags[0] === "--mcp") {
    const instructions = readFileSync("agents/performance/AGENT.md", "utf8");
    const server = new Server({ name: "playwright-performance", version: "1.0.0" },
      { capabilities: { tools: {} }, instructions });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const finding = assessPerformance(params.name, params.arguments ?? {});
      return { isError: finding.status === "denied", content: [{ type: "text", text: JSON.stringify(finding) }] };
    });
    await server.connect(new StdioServerTransport());
    return;
  }

  let request: { name?: unknown; arguments?: unknown } = {};
  if (!flags.length) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 1024) break;
      chunks.push(chunk);
    }
    if (size <= 1024) {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (parsed && Object.keys(parsed).length === 2 && Object.hasOwn(parsed, "name") && Object.hasOwn(parsed, "arguments"))
          request = parsed;
      } catch { /* Malformed requests follow the same denial path. */ }
    }
  }
  const finding = assessPerformance(request.name, request.arguments);
  process.stdout.write(JSON.stringify(finding) + "\n");
  process.exitCode = finding.status === "within_budget" ? 0 : finding.status === "regression_reproduced" ? 1 : 2;
}

main().catch(() => {
  process.stderr.write("The performance agent could not complete its invocation.\n");
  process.exitCode = 2;
});
