# Benchmark Script Flow

This document summarizes the current flow of `tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts`.

## Benchmark phases

| Phase | What happens? | Measured signal | Timeout / wait | Nudge? |
|---|---|---|---|---|
| 1. Landing + session start | Open landing page, launch `BENCH_TARGET_APP`, wait for IDE shell initialization | `startup-session-ready` | `BENCH_SETUP_TIMEOUT_MS`, default `600000 ms` | No |
| 2. Prepare benchmark file | Create `BubbleSort.java` and write a valid baseline class | none | short internal waits only | No |
| 3. Warmup error injection | Insert a known invalid Java line to trigger the first diagnostics path | `first-error-latency` | `BENCH_WARMUP_TIMEOUT_MS`, default `300000 ms` | Yes, optional |
| 4. Restore baseline after warmup | Rewrite the file to a valid baseline again | none | immediate transition into clean-state waiting | Indirectly in next phase |
| 5. Clean state after warmup | Wait until `.squiggly-error` disappears and the clean state stays stable | no dedicated metric, only stabilization | `90000 ms` in `waitForCleanState(...)` | Yes, optional |
| 6. Stabilization wait | Extra pause after the first successful cleanup to let project initialization settle | none | `BENCH_STABILIZATION_WAIT_MS`, default `5000 ms` | No |
| 7. Per-probe baseline reset | Before every measured probe, rewrite the valid baseline | none | short internal waits only | No |
| 8. Per-probe clean-state confirmation | Measure how long it takes until the editor returns to a stable clean state | `clean-state-latency` | `90000 ms` | Yes, optional |
| 9. Per-probe error injection | Insert a new invalid line marked with `BENCH_MARKER_n` | `warm-error-latency` | `BENCH_PROBE_TIMEOUT_MS`, default `15000 ms` | Yes, optional |
| 10. Repeat | Repeat the clean/error cycle for `BENCH_PROBES` probes | repeated clean + warm signals | default `20` probes | as above |

## Nudge behavior

| Context | When does the nudge happen? | Default | Nudge action |
|---|---|---|---|
| Warmup / first error | If no `.squiggly-error` appears after `BENCH_WARMUP_NUDGE_AFTER_MS` | `240000 ms` = 4 minutes | Click editor, go to end, insert `Space`, remove it with `Backspace`, then save |
| Warm probes: error should appear | If no `.squiggly-error` appears after `5000 ms` | `5000 ms` | Same editor nudge with save |
| Clean state should return | After `10` consecutive stale polls while squigglies are still visible | `10 × 500 ms` = `5000 ms` | Same editor nudge with save |

## Practical order

The current script therefore behaves like this:

1. start session
2. establish valid baseline
3. inject one warmup error
4. wait for first visible diagnostics
5. restore valid baseline
6. wait for clean state
7. wait an extra 5 seconds
8. then for each measured probe:
   - rewrite valid baseline
   - measure clean-state return
   - inject a new error
   - measure warm diagnostic latency

## Current defaults

| Variable | Default |
|---|---|
| `BENCH_SETUP_TIMEOUT_MS` | `600000 ms` |
| `BENCH_WARMUP_TIMEOUT_MS` | `300000 ms` |
| `BENCH_WARMUP_NUDGE_AFTER_MS` | `240000 ms` |
| `BENCH_STABILIZATION_WAIT_MS` | `5000 ms` |
| `BENCH_PROBES` | `20` |
| `BENCH_PROBE_TIMEOUT_MS` | `15000 ms` |
