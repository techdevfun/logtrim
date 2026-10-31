# logtrim

Your build log is 40,000 lines. Your agent's context window is not.

`logtrim` sits in a pipe and shrinks verbose logs and tool output down to a
token budget — keeping the beginning, the end, and every error line, while
collapsing the repetitive middle into one-line markers that say what was
dropped. Zero dependencies, plain Node.js, works on stdin or a file.

## Before / after

The bundled `examples/sample.log` is a 62-line build log (715 estimated
tokens) full of progress spam, repeated warnings, and one real failure:

```sh
node bin/logtrim.js examples/sample.log --stats --budget 300
```

```
Starting build: my-app@1.4.2 (node v24.20.0)
Resolving dependencies...
Installing 184 packages...
Compiling module 1/184: utils
Compiling module 2/184: config
... [20 lines omitted to fit 300-token budget] ...
... [10 similar lines omitted] ...
warning: unused variable 'tmp' in src/reports.js:42
warning: unused variable 'tmp' in src/reports.js:42
... [6 identical lines omitted] ...
... [4 lines omitted to fit 300-token budget] ...
✗ billing: 3 failing
Error: Cannot find module './currency' in /app/src/billing/rates.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)
    at Module._load (node:internal/modules/cjs/loader:981:27)
    at Module.require (node:internal/modules/cjs/loader:1231:19)
Traceback (most recent call last):
  File "tools/check.py", line 88, in verify
    raise ValueError("checksum mismatch for chunk 41")
ValueError: checksum mismatch for chunk 41
... [1 line omitted to fit 300-token budget] ...
Retrying upload (attempt 1/3)...
Retrying upload (attempt 2/3)...
Retrying upload (attempt 3/3)...
ERROR: upload failed after 3 attempts: connection reset by peer
Build finished with errors (exit code 1)
```

Result: **62 → 26 lines, 715 → 289 tokens, 41 lines omitted** — and the two
errors, the stack trace, and the start of the log all survive. With the
default budget (2000 tokens) the same file goes to 48 lines / 559 tokens,
dropping only the collapsed repeats. Full output is in
`examples/trimmed-example.txt`.

## Install

```sh
# needs Node.js 18+
git clone https://github.com/techdevfun/logtrim.git
cd logtrim
npm link   # makes `logtrim` available everywhere
```

Or just run it without installing:

```sh
node bin/logtrim.js --help
```

## Usage

```sh
# Trim a failing build before pasting it to your agent
npm run build 2>&1 | logtrim --budget 1500

# Trim a saved log file, see what was cut
logtrim --budget 800 --stats deploy.log

# From stdin, explicit
cat deploy.log | logtrim --budget 800
```

| Option | Default | What it does |
|---|---|---|
| `--budget N` | 2000 | Token budget for the output (~1 token = 4 chars, estimated) |
| `--head N` | 40 | Lines always kept from the start |
| `--tail N` | 60 | Lines always kept from the end |
| `--max-line N` | 500 | Truncate lines longer than N chars, with a note |
| `--no-errors` | off | Don't prioritize error lines when over budget |
| `--no-dedupe` | off | Don't collapse repeated / similar lines |
| `--stats` | off | Print `{inputLines, outputLines, inputTokens, outputTokens, omittedLines}` as JSON to stderr |
| `--help`, `--version` | | Show help / version |

Exit codes: `0` ok · `1` input file not found / unreadable · `2` bad arguments.

## How trimming works

1. **Collapse blank runs** — 5 blank lines become 1.
2. **Collapse identical runs** — 8 copies of the same warning become 2 copies
   plus `... [6 identical lines omitted] ...`.
3. **Collapse similar runs** — 12 `Processed N/1000 records` lines become 2
   plus `... [10 similar lines omitted] ...`. "Similar" means the same shape
   with only numbers differing. Error lines are never collapsed this way.
4. **Truncate absurdly long lines** — a 3 KB single-line JSON blob gets cut
   to `--max-line` chars with a `[truncated, N chars]` note.
5. **If still over budget** — keep head + error lines + tail, drop the
   middle, and mark each gap with `... [N lines omitted to fit B-token
   budget] ...`. Middle lines go first so the start and end survive.
6. **Last resort** — if error lines alone exceed the budget, they are
   truncated to share it. Output never exceeds the budget.

Token counts are estimates (characters / 4). That is accurate enough to
decide what to keep, and it keeps the tool dependency-free. If you need
exact tokenizer counts, pipe through a real tokenizer first and pass the
result as `--budget`.

## Why not just `head` / `tail`?

`head -100` cuts the error at the end. `tail -100` cuts the context at the
start. `grep -i error` cuts everything that explains *why* the error
happened. `logtrim` keeps all three: the setup, the failure, and the
aftermath — and tells you exactly how much it removed.

## Roadmap

- `--format json` passthrough: keep JSON log lines intact instead of
  truncating mid-object.
- `--keep PATTERN`: user-supplied regex for lines that must survive.
- `--watch`: follow a growing log file and re-trim on change.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
