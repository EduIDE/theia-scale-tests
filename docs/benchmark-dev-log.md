# Benchmark Development Log (test3)

This log tracks implementation decisions, blockers, and validated behavior for the Playwright-only LS benchmark work.

## 2026-03-21 — Current state snapshot

### Confirmed/validated

- Landing launch selectors on test3 were inspected directly in a live browser session.
  - Valid selector for external Java sidecar app: `launch-app-java-17-no-ls`
  - Invalid on this env: `launch-app-java-17-no-ls-latest`
- Auth bypass workflow is active for benchmark development (`DISABLE_AUTH=1`).
- Debug logging is implemented and writes to:
  - `test-data/debug/playwright-debug.log`
- Scale setup now logs available launch `data-testid`s before click.
- Session startup timeout in setup was extended and made configurable.

### Known issues encountered

1. Session startup variability on test3 ("Setting up your development workspace...") can be slow and intermittent.
2. File-based URL handoff (`ide-url-0.txt`) can become stale and fail later runs.
3. Diagnostics signal cleanup is flaky (squiggle may persist after edits/undo in same file).

### Decisions locked with user

- Benchmark path should remain in a **single browser window/session**.
  - Do not close and reopen window during benchmark run.
  - Reloading same window is acceptable as fallback.
- Prefer **same-file warm probes** (append invalid lines) over creating new file per probe.
- Startup handling:
  - wait up to 5 minutes, then fail.
  - measure startup duration for comparison.
- Diagnostic timing split:
  - time to first error (cold/init)
  - time between subsequent errors (warm)
- Warm probes target per run: **5**.

### Next implementation direction

1. Refactor benchmark spec to launch directly from landing and stay in same session.
2. Remove benchmark dependency on persisted IDE URL file.
3. Record metrics explicitly:
   - startup duration,
   - first-error latency,
   - 5 warm-probe latencies.
4. Keep verbose debug logging and append to this log after major checkpoints.

## 2026-03-22 — Baseline writer + warm probe stabilization checkpoint

### What changed

- Refactored benchmark flow to launch directly from landing and measure in the same session (no persisted IDE URL dependency during benchmark run).
- Increased benchmark project timeout to support the 5-minute startup policy.
- Reworked baseline writer to use deterministic full-text insertion (`insertText`) to avoid malformed braces from incremental key events.
- Kept the user-preferred invariant: return to clean baseline (hidden squiggle) before warmup and before measured phase.

### Validation run (headed, single worker, no deps, no retries)

- Command:
  - `npx playwright test tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts --project=benchmark --headed --workers=1 --reporter=line --no-deps --retries=0`
- Result: **PASS**

### Measured sample (test3, java-17-no-ls)

- startup latency: `8993ms` (session-ready)
- first-error latency (warmup/init): `39164ms`
- warm probe latencies (5 probes):
  - probe1: `297ms`
  - probe2: `183ms`
  - probe3: `201ms`
  - probe4: `208ms`
  - probe5: `210ms`

### Notes

- The screenshot concern about malformed trailing braces was valid and is addressed by the baseline writer change.
- Session startup on test3 remains variable; timeout guard stays necessary.
