#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { scan } from "./render/scan.js";
import { renderTerminal, exitCode } from "./report/terminal.js";
import type { Severity } from "./checks/types.js";

const HELP = `
akshara — find broken Indic text rendering

  akshara <url|file> [options]

Options
  --json <path>        Write the full result as JSON
  --screenshot <path>  Write a screenshot with the findings boxed
  --width <px>         Viewport width (default 393, a mid-range Android)
  --height <px>        Viewport height (default 852)
  --settle <ms>        Extra wait for late webfonts (default 600)
  --timeout <ms>       Navigation timeout (default 30000)
  --fail-on <level>    error | warning | info | never  (default error)
  --quiet              Only write files, no terminal report
  --help

Examples
  akshara https://example.in
  akshara ./fixtures/torture.html --screenshot out.png
  akshara https://example.in --json report.json --fail-on warning
`;

interface Args {
  target?: string | undefined;
  json?: string | undefined;
  screenshot?: string | undefined;
  width?: number;
  height?: number;
  settle?: number;
  timeout?: number;
  failOn: Severity | "never";
  quiet: boolean;
  help: boolean;
}

function parse(argv: string[]): Args {
  const args: Args = { failOn: "error", quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    switch (a) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--json":
        args.json = next();
        break;
      case "--screenshot":
        args.screenshot = next();
        break;
      case "--width":
        args.width = Number(next());
        break;
      case "--height":
        args.height = Number(next());
        break;
      case "--settle":
        args.settle = Number(next());
        break;
      case "--timeout":
        args.timeout = Number(next());
        break;
      case "--fail-on": {
        const v = next();
        if (v !== "error" && v !== "warning" && v !== "info" && v !== "never") {
          throw new Error(`--fail-on must be error, warning, info or never (got "${v}")`);
        }
        args.failOn = v;
        break;
      }
      default:
        if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
        args.target ??= a;
    }
  }
  return args;
}

/** Accept a URL or a local path, so the fixture and a live site work the same way. */
function toUrl(target: string): string {
  if (/^https?:\/\//i.test(target) || target.startsWith("file://")) return target;
  const path = resolve(target);
  if (!existsSync(path)) {
    throw new Error(`No such file: ${target} (and it is not an http(s) URL)`);
  }
  return pathToFileURL(path).href;
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parse(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`\n  ${(err as Error).message}\n${HELP}`);
    return 2;
  }

  if (args.help || !args.target) {
    process.stdout.write(HELP);
    return args.help ? 0 : 2;
  }

  let url: string;
  try {
    url = toUrl(args.target);
  } catch (err) {
    process.stderr.write(`\n  ${(err as Error).message}\n\n`);
    return 2;
  }

  const result = await scan(url, {
    ...(args.width !== undefined ? { width: args.width } : {}),
    ...(args.height !== undefined ? { height: args.height } : {}),
    ...(args.settle !== undefined ? { settleMs: args.settle } : {}),
    ...(args.timeout !== undefined ? { timeoutMs: args.timeout } : {}),
    ...(args.screenshot ? { screenshotPath: args.screenshot } : {}),
  });

  if (args.json) {
    await writeFile(args.json, JSON.stringify(result, null, 2) + "\n", "utf8");
  }
  if (!args.quiet) {
    process.stdout.write(renderTerminal(result));
  }
  if (args.screenshot && !args.quiet) {
    process.stdout.write(`  screenshot → ${args.screenshot}\n\n`);
  }

  return args.failOn === "never" ? 0 : exitCode(result.findings, args.failOn);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`\n  ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.exit(1);
  },
);
