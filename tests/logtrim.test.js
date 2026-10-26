import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { trimLines, trimText, isErrorLine, estimateTokens } from "../src/logtrim.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "bin", "logtrim.js");

test("short input passes through untouched", () => {
  const { lines, stats } = trimLines(["hello", "world"]);
  assert.deepEqual(lines, ["hello", "world"]);
  assert.equal(stats.omittedLines, 0);
});

test("empty input gives empty output", () => {
  const { lines, stats } = trimText("");
  assert.deepEqual(lines, []);
  assert.equal(stats.inputLines, 0);
  assert.equal(stats.outputTokens, 0);
});

test("output never exceeds the budget", () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i} with some filler text here`);
  const { lines: out, stats } = trimLines(lines, { budgetTokens: 200 });
  assert.ok(stats.outputTokens <= 200, `got ${stats.outputTokens}`);
  assert.ok(out.length < lines.length);
});

test("error lines survive even when far over budget", () => {
  // Filler lines vary in length so they are NOT collapsed as "similar".
  const filler = (i) => `filler line ${i} ${"x".repeat(i % 40)}`;
  const lines = [
    "starting build",
    ...Array.from({ length: 500 }, (_, i) => filler(i)),
    "ERROR: cannot find module 'left-pad'",
    ...Array.from({ length: 500 }, (_, i) => filler(1000 + i)),
    "done",
  ];
  const { lines: out } = trimLines(lines, { budgetTokens: 100 });
  assert.ok(out.some((l) => l.includes("ERROR: cannot find module")));
  assert.ok(out.some((l) => l.includes("omitted to fit")));
});

test("runs of identical lines collapse with a marker", () => {
  const lines = ["start", ...Array(10).fill("warning: unused variable x"), "end"];
  const { lines: out, stats } = trimLines(lines, { budgetTokens: 2000 });
  assert.ok(out.some((l) => l.includes("8 identical lines omitted")));
  assert.equal(stats.omittedLines, 8);
});

test("runs of similar lines (only numbers differ) collapse", () => {
  const lines = [
    "start",
    ...Array.from({ length: 12 }, (_, i) => `Processed ${i}/1000 records from shard 7`),
    "end",
  ];
  const { lines: out } = trimLines(lines, { budgetTokens: 2000 });
  assert.ok(out.some((l) => l.includes("10 similar lines omitted")));
});

test("long lines are truncated with a note", () => {
  const long = `x`.repeat(1200);
  const { lines: out } = trimLines([long], { budgetTokens: 2000, maxLineChars: 100 });
  assert.ok(out[0].includes("[truncated, 1200 chars]"));
  assert.ok(out[0].length < 200);
});

test("consecutive blank lines collapse to one", () => {
  const { lines: out } = trimLines(["a", "", "", "", "b"], { budgetTokens: 2000 });
  assert.deepEqual(out, ["a", "", "b"]);
});

test("head and tail are kept when over budget", () => {
  // Lines vary in length so they are NOT collapsed as "similar".
  const lines = Array.from(
    { length: 300 },
    (_, i) => `unique line number ${i} ${"y".repeat(i % 37)}`,
  );
  const { lines: out } = trimLines(lines, {
    budgetTokens: 150,
    headLines: 5,
    tailLines: 5,
  });
  assert.ok(out[0].includes("unique line number 0"));
  assert.ok(out[out.length - 1].includes("unique line number 299"));
});

test("budget marker counts lines dropped while fitting", () => {
  // Regression: selectHeadErrorsTail inserts a 290-line gap marker, then
  // fitToBudget dropped 5 more head/tail lines without updating it, so
  // the marker said 290 while stats said 295 omitted.
  const lines = Array.from(
    { length: 300 },
    (_, i) => `unique line number ${i} ${"y".repeat(i % 37)}`,
  );
  const { lines: out, stats } = trimLines(lines, {
    budgetTokens: 50,
    headLines: 5,
    tailLines: 5,
  });
  assert.ok(stats.outputTokens <= 50, `got ${stats.outputTokens}`);
  const marker = out.find((l) => l.includes("omitted to fit 50-token budget"));
  assert.ok(marker, "expected a budget marker");
  assert.ok(
    marker.includes(`${stats.omittedLines} lines omitted`),
    `marker ${marker} should agree with stats omittedLines ${stats.omittedLines}`,
  );
  // Markers + kept original lines must account for every input line.
  const keptOriginal = out.filter((l) => !l.includes("omitted")).length;
  const markerTotal = out
    .filter((l) => l.includes("omitted"))
    .reduce((sum, l) => sum + Number(l.match(/(\d+) lines omitted/)[1]), 0);
  assert.equal(keptOriginal + markerTotal, 300);
});

test("isErrorLine catches errors, stack frames, failures", () => {
  assert.equal(isErrorLine("Error: something broke"), true);
  assert.equal(isErrorLine("    at doThing (index.js:12:3)"), true);
  assert.equal(isErrorLine("FAILED tests/unit/foo.test.js"), true);
  assert.equal(isErrorLine("all green, 42 passing"), false);
  assert.equal(isErrorLine(""), false);
});

test("estimateTokens is roughly chars/4", () => {
  assert.equal(estimateTokens("abcd".repeat(25)), 25);
  assert.equal(estimateTokens(""), 0);
});

test("CLI trims stdin and --stats reports JSON on stderr", () => {
  const input = `${"filler line\n".repeat(300)}ERROR: boom\n`;
  const res = spawnSync(process.execPath, [cli, "--budget", "100", "--stats"], {
    input,
    encoding: "utf8",
  });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes("ERROR: boom"));
  const stats = JSON.parse(res.stderr.trim());
  assert.equal(stats.inputLines, 301);
  assert.ok(stats.outputTokens <= 100);
});

test("CLI exits 2 on unknown option and 1 on missing file", () => {
  const bad = spawnSync(process.execPath, [cli, "--nope"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option/);
  const missing = spawnSync(process.execPath, [cli, "definitely-not-a-file-xyz.log"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cannot read/);
});

test("CLI --help and --version exit 0", () => {
  assert.equal(spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).status, 0);
  const v = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
  assert.equal(v.status, 0);
  assert.match(v.stdout, /logtrim 0\.1\.0/);
});

test("CLI accepts --option=value form", () => {
  const input = `${"filler line\n".repeat(300)}ERROR: boom\n`;
  const res = spawnSync(process.execPath, [cli, "--budget=100", "--stats"], {
    input,
    encoding: "utf8",
  });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes("ERROR: boom"));
  const stats = JSON.parse(res.stderr.trim());
  assert.ok(stats.outputTokens <= 100);
  // Empty value must be rejected, like other bad values.
  const bad = spawnSync(process.execPath, [cli, "--budget="], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /positive integer/);
});
