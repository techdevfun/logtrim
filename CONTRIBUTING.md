# Contributing to logtrim

Small, focused PRs are welcome.

- Keep it zero-dependency. If a feature needs a package, it probably
  doesn't belong here.
- Add a test in `tests/logtrim.test.js` for every behavior change
  (`node --test tests/logtrim.test.js`).
- Keep the CLI contract stable: flags, exit codes, and the `--stats` JSON
  shape. If you must change them, say so loudly in the PR description.
- Run the sample before pushing:
  `node bin/logtrim.js examples/sample.log --stats --budget 300`
  and make sure errors still survive and output stays within budget.
