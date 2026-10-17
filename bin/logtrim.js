#!/usr/bin/env node
// logtrim — trim verbose logs / tool output to a token budget.
// Usage: some-command 2>&1 | logtrim --budget 2000 --stats
import { readFileSync } from "node:fs";
import { trimText } from "../src/logtrim.js";

const VERSION = "0.1.0";

const HELP = `logtrim ${VERSION} — trim verbose logs to a token budget, keep the errors.

Usage:
  <command> 2>&1 | logtrim [options]
  logtrim [options] [file]        read from a file instead of stdin ("-" = stdin)

Options:
  --budget N      token budget for the output (default 2000, ~1 token = 4 chars)
  --head N        lines to always keep from the start (default 40)
  --tail N        lines to always keep from the end (default 60)
  --max-line N    truncate lines longer than N chars (default 500)
  --no-errors     do not prioritize error lines when over budget
  --no-dedupe     do not collapse repeated / similar lines
  --stats         print input/output stats as JSON to stderr
  --help, -h      show this help
  --version, -v   show version

Exit codes: 0 ok · 1 input file not found / unreadable · 2 bad arguments.
`;

function fail(message, code) {
  process.stderr.write(`logtrim: ${message}\n`);
  process.exit(code);
}

function parseIntOption(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    fail(`--${name} must be a positive integer, got "${value}"`, 2);
  }
  return n;
}

function parseArgs(argv) {
  const opts = {
    budgetTokens: 2000,
    headLines: 40,
    tailLines: 60,
    maxLineChars: 500,
    keepErrors: true,
    dedupe: true,
    stats: false,
    file: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === "--version" || arg === "-v") {
      process.stdout.write(`logtrim ${VERSION}\n`);
      process.exit(0);
    }
    if (arg === "--stats") opts.stats = true;
    else if (arg === "--no-errors") opts.keepErrors = false;
    else if (arg === "--no-dedupe") opts.dedupe = false;
    else if (arg === "--budget" || arg === "--head" || arg === "--tail" || arg === "--max-line") {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`, 2);
      i += 1;
      if (arg === "--budget") opts.budgetTokens = parseIntOption("budget", value);
      if (arg === "--head") opts.headLines = parseIntOption("head", value);
      if (arg === "--tail") opts.tailLines = parseIntOption("tail", value);
      if (arg === "--max-line") opts.maxLineChars = parseIntOption("max-line", value);
    } else if (arg.startsWith("--")) {
      fail(`unknown option "${arg}" (try --help)`, 2);
    } else if (opts.file !== null) {
      fail("only one input file is allowed", 2);
    } else {
      opts.file = arg;
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let input;
  try {
    if (opts.file === null || opts.file === "-") {
      input = readFileSync(0, "utf8");
    } else {
      input = readFileSync(opts.file, "utf8");
    }
  } catch {
    fail(
      `cannot read ${opts.file === null ? "stdin" : `"${opts.file}"`} (file not found?)`,
      1,
    );
  }
  const { lines, stats } = trimText(input, opts);
  process.stdout.write(lines.length > 0 ? `${lines.join("\n")}\n` : "");
  if (opts.stats) {
    process.stderr.write(`${JSON.stringify(stats)}\n`);
  }
}

main();
