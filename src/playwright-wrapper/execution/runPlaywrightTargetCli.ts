import { runPlaywrightTarget } from "./runPlaywrightTarget";
import type { PlaywrightTargetRequest } from "../contract/validateInputs";

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(argv: string[]): PlaywrightTargetRequest {
  const request: Partial<PlaywrightTargetRequest> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

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

  return request as PlaywrightTargetRequest;
}

function main(): void {
  try {
    const request = parseArgs(process.argv.slice(2));
    const result = runPlaywrightTarget(request);

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
  }
}

main();