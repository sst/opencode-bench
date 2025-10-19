# Benchmark Sample Observations

Summary of why low-scoring `opencode/claude-sonnet-4-5` runs (from the `benchmarks-sample-*.json` batch) scored poorly. None of these runs crashed; each completed normally and was downgraded for concrete regressions the judges flagged.

## Instability Observations (gpt-5-codex vs claude-sonnet-4-5)
- **API signature swings** came from actual parameter-order swaps and judge disagreement on renamed tests. When GPT-5 codex flipped the signature, all three judges (claude-4.5, gpt-5-codex, kimi) returned 0; when the signature matched but tests were reorganised, kimi alone flagged issues (e.g., missing docstring), yielding 0.66 averages.
- **Logic-equivalence variability** matched behavioural shifts. The guard clause `if failure_count == 0: return` led every judge to fail the run; when only the wrapper call moved, claude-4.5 often passed, gpt-5-codex failed, and kimi alternated, producing the 0.33/0.67 averages.
- **Test-coverage oscillation** reflected conflicting empty-list assertions and wrapper scenarios. gpt-5-codex and kimi downgraded runs that asserted `assert_not_called()` for empty lists, while claude-4.5 occasionally passed them, so outcomes toggled between 0 and 0.33/1.0.
- **Checks score fluctuations** depended on pytest regressions. Runs keeping pytest green scored 1; runs introducing new failures dropped to 0. Partial averages (0.66) appeared when kimi counted new lint errors in an already-failing flake8 run while claude-4.5 and gpt-5-codex ignored them.
- **Integration-points** stayed at 0 whenever the wrapper call moved or arguments were reordered. gpt-5-codex and kimi consistently failed those diffs; claude-4.5 sometimes passed them, creating 0.66 averages.

### Suggested Stabilizations
- Replace fuzzy LLM scorers with deterministic analysis wherever possible: use AST or scripted checks for integration call order/signature differences, and synthesize inputs to compare actual side effects (all tied to the empty-list regression).
- Convert critical behaviours (e.g., emitting a metric with value 0 for an empty `batchItemFailures` list) into explicit regression tests rather than relying on post-hoc logic/coverage judgements.
- Tighten LLM prompts to reference concrete diff sections (wrapper call order, empty-list branch) so judges answer binary questions instead of offering broad narratives.
- For `checks`, compute regressions mechanically via exit-code comparisons before involving any judge; treat pytest 0→1 as a hard fail and decide lint policy in code rather than letting models reinterpret flake8 failures.
- Cache the agent diff once per run and share it across scorers to ensure consistent input; today each scorer re-derives `git diff`, which can shift contextual snippets.
- Fail fast or rerun when an agent produces no diff (e.g., skipped GPT-5 codex run in benchmarks-sample-9) so aggregated results aren’t skewed by missing samples.

## benchmarks-sample-1.json (final score 0.111)
- Logic-equivalence: candidate stops emitting the metric for an empty `batchItemFailures` list; reference emits value `0`. All judges (claude-4.5, gpt-5-codex, kimi) failed it. (`benchmarks-sample-1.json:228`)
- Integration-points: wrapper call moved later in `_after`, arguments swapped to `(context, response)`; gpt-5-codex and kimi scored 0 while claude-4.5 occasionally passed similar diffs. (`benchmarks-sample-1.json:80-100`)
- Test-coverage: empty-list test now asserts `assert_not_called()` instead of `assert_called_once_with(..., 0)`. (`benchmarks-sample-1.json:300`)
- Checks: pytest regressed with eight failing `TestBatchItemFailuresMetric` cases. (`benchmarks-sample-1.json:320-339`)

## benchmarks-sample-4.json (final score 0.322)
- Logic-equivalence: same empty-list regression; all judges failed it. (`benchmarks-sample-4.json:228-244`)
- Integration-points: claude-4.5 passed while gpt-5-codex and kimi failed, yielding the 0.666 average as the call moved relative to `extract_http_status_code_tag`. (`benchmarks-sample-4.json:248-272`)
- Test-coverage: empty-list assertion mismatch (no metric vs value 0) flagged by all three judges. (`benchmarks-sample-4.json:300-302`)
- Checks: pytest stayed green; run completed successfully.

## benchmarks-sample-8.json (final score 0.211)
- Integration-points: import moved to module level, call executes later, arguments reversed; gpt-5-codex and kimi failed it while claude-4.5 has passed similar diffs elsewhere. (`benchmarks-sample-8.json:86-100`)
- Test-coverage: empty-list test asserts the metric is not called, conflicting with reference; gpt-5-codex and kimi downgraded the run. (`benchmarks-sample-8.json:300-302`)
- Logic-equivalence averaged 0.0 because gpt-5-codex and kimi treated the empty-list change as a regression while claude-4.5 passed it in this run. (`benchmarks-sample-8.json:228-244`)

## benchmarks-sample-9.json (final score 0.211)
- Only claude run recorded; GPT-5 run produced no diff and was skipped (expected behaviour when `finalizeAgentChanges` finds nothing to commit).
- Logic-equivalence: candidate added `if failure_count == 0: return`, removing the empty-list metric; claude-4.5, gpt-5-codex, and kimi all scored 0. (`benchmarks-sample-9.json:57-72`)
- Test-coverage: same empty-list assertion mismatch and missing wrapper scenario flagged by gpt-5-codex and kimi. (`benchmarks-sample-9.json:121-130`)
- Checks: pytest stayed passing with additional tests; flake8 remained in its baseline failing state for every judge.

Overall, every low score stems from deliberate behavioural changes (primarily skipping the empty-list metric) or integration shifts, not from agent crashes.
