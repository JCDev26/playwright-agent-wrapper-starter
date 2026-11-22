import { runPlaywrightTarget, type RunPlaywrightOptions } from "./runPlaywrightTarget";
import type { PlaywrightTargetRequest } from "../contract/validateInputs";

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(argv: string[]): { request: PlaywrightTargetRequest; options: RunPlaywrightOptions } {
  const request: Partial<PlaywrightTargetRequest> = {};
  const options: RunPlaywrightOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--timeout-ms" || arg === "--cleanup-timeout-ms") {
      const value = Number(requireValue(arg, argv[index + 1]));
      if (arg === "--timeout-ms") options.timeoutMs = value;
      else options.cleanupTimeoutMs = value;
      index += 1;
      continue;
    }

    if (arg === "--project") {
      request.project = requireValue("--project", argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--spec") {
      request.spec = requireValue("--spec", argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--grep") {
      request.grep = requireValue("--grep", argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--headed") {
      request.headed = true;
      continue;
    }

    if (arg === "--workers") {
      const raw = requireValue("--workers", argv[index + 1]);
      request.workers = Number(raw);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!request.project) {
    throw new Error("Missing required argument: --project <name>");
  }

  return { request: request as PlaywrightTargetRequest, options };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  try {
    const { request, options } = parseArgs(process.argv.slice(2));
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    const result = await runPlaywrightTarget(request, { ...options, signal: controller.signal });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    if (result.ok && result.status === "passed") {
      process.exitCode = 0;
      return;
    }

    if (result.ok && result.status === "failed") {
      process.exitCode = 1;
      return;
    }

    process.exitCode = 2;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unknown CLI parsing error."}\n`,
    );
    process.exitCode = 2;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

void main();
