import { readFileSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

interface AgentEndpoint {
  role: "performance" | "security" | "reporting";
  tool: Tool;
  execute(name: unknown, args: unknown): { status: string };
  passingStatus: string;
  failingStatus: string;
}

async function readRequest(): Promise<{ name?: unknown; arguments?: unknown }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 1024) return {};
    chunks.push(chunk);
  }
  try {
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (request && Object.keys(request).length === 2 && Object.hasOwn(request, "name") && Object.hasOwn(request, "arguments"))
      return request;
  } catch { /* Invalid input is handled by the same role-specific denial path. */ }
  return {};
}

/** Each entry point supplies a single capability. Only the host chooses which endpoint a client receives. */
export function serveAgent(endpoint: AgentEndpoint) {
  async function main() {
    process.chdir(path.resolve(__dirname, "../../.."));
    const flags = process.argv.slice(2);
    if (flags.length === 1 && flags[0] === "--mcp") {
      const instructions = readFileSync(path.join("agents", endpoint.role, "AGENT.md"), "utf8");
      const server = new Server({ name: "playwright-" + endpoint.role, version: "1.0.0" },
        { capabilities: { tools: {} }, instructions });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [endpoint.tool] }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const finding = endpoint.execute(params.name, params.arguments ?? {});
        return { isError: finding.status === "denied", content: [{ type: "text", text: JSON.stringify(finding) }] };
      });
      await server.connect(new StdioServerTransport());
      return;
    }
    const request = flags.length ? {} : await readRequest();
    const finding = endpoint.execute(request.name, request.arguments);
    process.stdout.write(JSON.stringify(finding) + "\n");
    process.exitCode = finding.status === endpoint.passingStatus ? 0 : finding.status === endpoint.failingStatus ? 1 : 2;
  }
  main().catch(() => {
    process.stderr.write("The " + endpoint.role + " agent could not complete its invocation.\n");
    process.exitCode = 2;
  });
}
