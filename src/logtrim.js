// logtrim — shrink verbose logs / tool output to a token budget.
//
// Strategy, in order:
//   1. Collapse runs of blank lines.
//   2. Collapse runs of identical lines and runs of near-identical lines
//      (same shape, only numbers differ — e.g. progress spam).
//   3. Truncate absurdly long lines.
//   4. If still over budget: keep head + error lines + tail, drop the rest.
//   5. If error lines alone exceed the budget, truncate them to share it.
//
// Token counts are estimates: ~1 token per 4 characters. That is close
// enough to decide what to keep, and far cheaper than a real tokenizer.

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

const ERROR_RE =
  /(error|failed?|failure|exception|traceback|panic|fatal|assert|uncaught|denied|timeout|timed out|out of memory|segfault|eaddrinuse|enoent|econnrefused|permission denied|not found|invalid|warning)/i;
const STACK_RE =
  /^\s+at\s+\S+\s*\(.*\)\s*$|^\s+File\s+".*",\s+line\s+\d+|^\s+\^+\s*$|^\s+Caused by:/;

export function isErrorLine(line) {
  if (!line) return false;
  if (STACK_RE.test(line)) return true;
  if (/[✖✗❌]/.test(line)) return true;
  return ERROR_RE.test(line);
}

// Normalize a line for "similar run" detection: numbers become '#'.
function normalizeSimilar(line) {
  return line.replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function truncateLine(line, maxLineChars) {
  if (line.length <= maxLineChars) return line;
  return `${line.slice(0, maxLineChars)}… [truncated, ${line.length} chars]`;
}

// Collapse consecutive blank lines to at most one.
function collapseBlanks(items) {
  const out = [];
  let blankRun = 0;
  for (const item of items) {
    if (item.text.trim() === "") {
      blankRun += 1;
      if (blankRun === 1) out.push(item);
      // extra blanks are dropped; they represent omitted lines
      continue;
    }
    blankRun = 0;
    out.push(item);
  }
  return out;
}

// Collapse runs of identical lines: keep 2, replace the rest with a marker.
// Runs of 2 or fewer are left alone.
function collapseIdentical(items) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    let j = i + 1;
    while (j < items.length && items[j].text === items[i].text) j += 1;
    const run = j - i;
    if (run > 2) {
      out.push(items[i], items[i + 1]);
      out.push({
        text: `... [${run - 2} identical lines omitted] ...`,
        isError: false,
        represents: run - 2,
        marker: true,
      });
    } else {
      for (let k = i; k < j; k += 1) out.push(items[k]);
    }
    i = j;
  }
  return out;
}

// Collapse runs of near-identical lines (same normalized shape, >= 5 lines,
// no error lines inside): keep 2, replace the rest with a marker.
function collapseSimilar(items) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const key = normalizeSimilar(items[i].text);
    if (key.length < 8 || items[i].marker) {
      out.push(items[i]);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (
      j < items.length &&
      !items[j].marker &&
      normalizeSimilar(items[j].text) === key
    ) {
      j += 1;
    }
    const run = j - i;
    const hasError = items.slice(i, j).some((it) => it.isError);
    if (run >= 5 && !hasError) {
      out.push(items[i], items[i + 1]);
      out.push({
        text: `... [${run - 2} similar lines omitted] ...`,
        isError: false,
        represents: run - 2,
        marker: true,
      });
    } else {
      for (let k = i; k < j; k += 1) out.push(items[k]);
    }
    i = j;
  }
  return out;
}

// Select head + error lines + tail from processed items, inserting an
// omission marker wherever a gap is left.
function selectHeadErrorsTail(items, { headLines, tailLines, keepErrors, budgetTokens }) {
  const n = items.length;
  const keep = new Set();
  for (let i = 0; i < Math.min(headLines, n); i += 1) keep.add(i);
  for (let i = Math.max(0, n - tailLines); i < n; i += 1) keep.add(i);
  if (keepErrors) {
    for (let i = 0; i < n; i += 1) {
      if (items[i].isError) keep.add(i);
    }
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out = [];
  let prev = -1;
  for (const idx of sorted) {
    if (idx > prev + 1) {
      const gap = items
        .slice(prev + 1, idx)
        .reduce((sum, it) => sum + it.represents, 0);
      if (gap > 0) {
        out.push({
          text: `... [${gap} lines omitted to fit ${budgetTokens}-token budget] ...`,
          isError: false,
          represents: gap,
          marker: true,
        });
      }
    }
    out.push(items[idx]);
    prev = idx;
  }
  return out;
}

// Drop non-error, non-marker lines (middle of the output first, so the
// head start and tail end survive) until within budget. Markers are never
// dropped: they are small and explain what is missing. If only error lines
// remain and they still exceed it, truncate them to share the budget.
function fitToBudget(items, budgetTokens) {
  let kept = [...items];
  const tokensOf = (list) =>
    list.reduce((sum, it) => sum + estimateTokens(it.text), 0);
  let total = tokensOf(kept);
  if (total <= budgetTokens) return kept;

  // Middle-out order: index closest to the middle goes first.
  const middle = (kept.length - 1) / 2;
  const order = kept
    .map((it, idx) => ({ idx, tok: estimateTokens(it.text) }))
    .filter((e) => !kept[e.idx].isError && !kept[e.idx].marker)
    .sort((a, b) => Math.abs(a.idx - middle) - Math.abs(b.idx - middle));
  const drop = new Set();
  for (const e of order) {
    if (total <= budgetTokens) break;
    drop.add(e.idx);
    total -= e.tok;
  }
  kept = kept.filter((_, idx) => !drop.has(idx));
  if (total <= budgetTokens) return kept;
  if (kept.length === 0) return kept;

  // Only error lines (or markers) left and still over budget: share it.
  const perChars = Math.max(50, Math.floor((budgetTokens * 4) / kept.length));
  kept = kept.map((it) => {
    if (it.text.length <= perChars) return it;
    return {
      ...it,
      text: `${it.text.slice(0, perChars)}… [truncated to fit budget]`,
    };
  });
  total = tokensOf(kept);
  // Last resort: hard-truncate the final line so output never exceeds budget.
  if (total > budgetTokens && kept.length > 0) {
    const excessChars = (total - budgetTokens) * 4 + 4;
    const last = kept[kept.length - 1];
    kept[kept.length - 1] = {
      ...last,
      text: last.text.slice(0, Math.max(0, last.text.length - excessChars)),
    };
  }
  return kept;
}

export function trimLines(lines, options = {}) {
  const {
    budgetTokens = 2000,
    headLines = 40,
    tailLines = 60,
    maxLineChars = 500,
    keepErrors = true,
    dedupe = true,
  } = options;

  const inputLines = lines.length;
  const inputTokens = estimateTokens(lines.join("\n"));

  let items = lines.map((text) => ({
    text,
    isError: isErrorLine(text),
    represents: 1,
    marker: false,
  }));

  if (dedupe) {
    items = collapseBlanks(items);
    items = collapseIdentical(items);
    items = collapseSimilar(items);
  }
  items = items.map((it) =>
    it.marker ? it : { ...it, text: truncateLine(it.text, maxLineChars) },
  );

  const totalTokens = (list) =>
    list.reduce((sum, it) => sum + estimateTokens(it.text), 0);

  let selected;
  if (totalTokens(items) <= budgetTokens) {
    selected = items;
  } else {
    selected = selectHeadErrorsTail(items, {
      headLines,
      tailLines,
      keepErrors,
      budgetTokens,
    });
    selected = fitToBudget(selected, budgetTokens);
  }

  const outputLines = selected.map((it) => it.text);
  // Every input line either survives as a plain output line or is omitted
  // (collapsed behind a marker, or dropped to fit the budget).
  const keptOriginal = selected.filter((it) => !it.marker).length;
  return {
    lines: outputLines,
    stats: {
      inputLines,
      outputLines: outputLines.length,
      inputTokens,
      outputTokens: estimateTokens(outputLines.join("\n")),
      omittedLines: Math.max(0, inputLines - keptOriginal),
    },
  };
}

export function trimText(text, options = {}) {
  const lines = text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
  // A trailing newline means "last line ended", not an extra empty line.
  if (lines.length > 0 && lines[lines.length - 1] === "" && text.endsWith("\n")) {
    lines.pop();
  }
  return trimLines(lines, options);
}
