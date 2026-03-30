# Test3 Playwright-Only LS Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible benchmark pipeline on `test3` that compares internal (`java-17` embedded LS) vs external (`java-17-no-ls` + Java sidecar) language-server setups using Playwright UI latency + Kubernetes CPU/RAM measurements.

**Architecture:** Use `EduIDE-deployment` CI (`gh workflow run`) to deploy the target image/tag to `test3` once per architecture batch, then run deterministic Playwright benchmark scenarios from `theia-scale-tests` against `test3` URLs. Collect latency from UI red-underline appearance checks (2–3 deterministic probes per run) and collect resource metrics from a local `kubectl top` (1s) monitor script. Aggregate into CSV/JSON reports with median/p95 latency and avg/peak CPU+RAM, separated into cold and warm series.

**Tech Stack:** GitHub Actions (`gh` CLI), Kubernetes (`kubectl`), Playwright (`@playwright/test`), TypeScript/Node.js scripts, Bash scripts, CSV/JSON artifacts.

---

## 0) Scope and decomposition check

This effort spans **three subsystems**:
1. Benchmark scenario + reporting (`theia-scale-tests`)
2. Deployment trigger/watch flow (`EduIDE-deployment` CI dispatch)
3. Local cluster monitoring (`kubectl` polling)

These are related and can ship as one plan, but commits should stay subsystem-scoped.

---

## 1) File structure map (locked before implementation)

### Repository A: `EduIDE/theia-scale-tests`
- **Modify:** `playwright.env.template`
  - Add benchmark-specific env vars (target app, iterations, architecture label, output dir).
- **Modify:** `playwright.config.ts`
  - Add dedicated `benchmark` project with deterministic settings (no random flows, no scale randomness).
- **Create:** `tests/setup/benchmark.setup.ts`
  - Create benchmark IDE URL(s) for the target app on test3.
- **Create:** `tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts`
  - Deterministic UI-latency benchmark (inject syntax error, wait for problems indicator change, record ms).
- **Create:** `fixtures/utils/benchmark-metrics.ts`
  - Typed helper for benchmark records and CSV/JSON writing.
- **Create:** `fixtures/utils/statistics.ts`
  - Median, p95, avg, max utilities.
- **Create:** `tests/ide/benchmark/Statistics.unit.spec.ts`
  - Fast tests for median/p95/avg/max calculations.
- **Create:** `scripts/aggregate-benchmark.ts`
  - Aggregate per-run raw files into final result tables.
- **Modify:** `README.md`
  - Add benchmark runbook (test3-only).

### Repository B: `EduIDE-deployment`
- **Create:** `scripts/trigger-test3-deploy.sh`
  - Trigger `deploy-pr.yml` (workflow_dispatch) for test3 tags.
- **Create:** `scripts/watch-test3-deploy.sh`
  - Watch GH run + verify rollout readiness in `test3` namespace.
- **Modify (optional, only if needed):** `.github/workflows/deploy-pr.yml`
  - Keep optional: only if dispatch inputs need benchmark-specific convenience parameters.
- **Modify:** `README.md`
  - Document benchmark deployment trigger usage.

### Repository C: local orchestration (same machine running tests)
- **Create (in `theia-scale-tests` for portability):** `scripts/monitor-test3-resources.sh`
  - Poll `kubectl top` for IDE/session and sidecar pods, emit timestamped CSV.
- **Create:** `scripts/run-test3-benchmark.sh`
  - Orchestrate deploy trigger/watch + monitor + Playwright run + aggregation.

---

## 2) Branch/worktree strategy

Create dedicated worktrees; do not work on `main` directly.

### Branch names
- `theia-scale-tests`: `feature/benchmark-test3-ui-latency`
- `EduIDE-deployment`: `feature/test3-benchmark-deploy-trigger`

### Worktree layout (example)
- `/Users/nikolas/BA Workdir/wt/theia-scale-tests-benchmark`
- `/Users/nikolas/BA Workdir/wt/eduide-deployment-benchmark`

---

## 2.1) Locked benchmark decisions (agreed)

- Internal baseline app: `java-17` (embedded LS)
- External comparison app: `java-17-no-ls` (Java sidecar)
- Deployment trigger: `gh workflow run` (`deploy-pr.yml` in `EduIDE-deployment`)
- Redeploy cadence: once per architecture batch (not per single run)
- Iterations per architecture: `30`
- Latency endpoint: UI red-underline appearance
- Probes per run: `5` deterministic warm syntax-error probes
- Start modes: report `cold` and `warm` separately
- Timeout per probe: `15s`
- Resource sampling: `kubectl top` every `1s`
- Artifact format: CSV + JSON

---

## 3) Implementation tasks (bite-sized, TDD, frequent commits)

### Task 1: Create benchmark environment contract (`theia-scale-tests`)

**Files:**
- Modify: `/Users/nikolas/BA Workdir/theia-scale-tests/playwright.env.template`
- Modify: `/Users/nikolas/BA Workdir/theia-scale-tests/playwright.config.ts`
- Test: `/Users/nikolas/BA Workdir/theia-scale-tests/tests/ide/benchmark/Statistics.unit.spec.ts` (created in Task 2)

- [x] **Step 1: Add benchmark env vars (failing by usage reference first)**

```ts
// expected new vars consumed later
BENCH_ARCH=internal
BENCH_RUNS=30
BENCH_TARGET_APP=java-17
BENCH_OUTPUT_DIR=test-data/benchmark
BENCH_FIXED_FILE=src/de/BubbleSort.java
BENCH_MODE=cold # cold|warm
BENCH_PROBES=3
BENCH_PROBE_TIMEOUT_MS=15000
```

- [x] **Step 2: Add benchmark Playwright project in config**

```ts
{
  name: "benchmark",
  testMatch: /.*\.benchmark\.spec\.ts/,
  workers: 1,
  timeout: 120000,
  use: {
    ...devices["Desktop Chrome"],
    storageState: ".auth/keycloak_user.json",
    launchOptions: { slowMo: 0 }
  },
  dependencies: ["scale-setup"]
}
```

- [x] **Step 3: Run config sanity check**

Run: `npx playwright test --list --project=benchmark`

Expected: project `benchmark` listed with no config parse errors.

- [ ] **Step 4: Commit**

```bash
git add playwright.env.template playwright.config.ts
git commit -m "feat(benchmark): add dedicated benchmark project and env contract"
```

---

### Task 2: Add deterministic UI latency benchmark + stats helpers (`theia-scale-tests`)

**Files:**
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/fixtures/utils/statistics.ts`
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/tests/ide/benchmark/Statistics.unit.spec.ts`
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/fixtures/utils/benchmark-metrics.ts`
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts`
- Test: `/Users/nikolas/BA Workdir/theia-scale-tests/tests/ide/benchmark/Statistics.unit.spec.ts`

- [x] **Step 1: Write failing unit tests for statistics functions**

```ts
import { test, expect } from "@playwright/test";
import { median, p95, avg, max } from "../../../fixtures/utils/statistics";

test("median computes odd/even correctly", async () => {
  expect(median([1, 3, 2])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
});

test("p95 computes deterministic percentile", async () => {
  expect(p95([100, 120, 130, 140, 1000])).toBe(1000);
});
```

- [x] **Step 2: Run tests to confirm failure**

Run: `npx playwright test tests/ide/benchmark/Statistics.unit.spec.ts --project=benchmark`

Expected: FAIL (module/functions missing).

- [x] **Step 3: Implement minimal stats module**

```ts
export function median(values: number[]): number { /* sort + center */ }
export function p95(values: number[]): number { /* ceil(0.95*n)-1 index */ }
export function avg(values: number[]): number { /* sum/len */ }
export function max(values: number[]): number { /* Math.max */ }
```

- [x] **Step 4: Re-run stats tests**

Run: `npx playwright test tests/ide/benchmark/Statistics.unit.spec.ts --project=benchmark`

Expected: PASS.

- [x] **Step 5: Write failing benchmark spec skeleton**

```ts
test("ui diagnostic latency benchmark", async ({ page }) => {
  // open fixed Java file, inject deterministic syntax error,
  // wait until problem indicator increases, record latency
  expect(false).toBe(true); // temporary failing assertion
});
```

- [ ] **Step 6: Implement benchmark spec with deterministic flow** *(in progress: migrated to Monaco `.squiggly-error` primary signal; waiting for stable fresh session bootstrap in benchmark run)*

Core behavior:
1. Load IDE URL from setup file (`test-data/scale/ide-url-0.txt` or benchmark folder)
2. Open workspace/repo + fixed file (`BubbleSort.java`)
3. Place caret at 2–3 fixed probe locations and ensure deterministic baseline text
4. Insert known syntax error at fixed location (example: `String x = 1;`) per probe
5. Start timer before keystroke for each probe
6. Poll UI for red-underline evidence (Monaco decoration/marker indicator) with 15s timeout per probe
7. Persist per-probe latency record to JSONL/CSV with `mode=cold|warm`

Probe-level fields:
- architecture
- mode (`cold`/`warm`)
- run_id
- probe_id (`1..3`)
- latency_ms
- timeout_flag
- timestamp

- [ ] **Step 7: Run single benchmark test locally** *(in progress: headed single-window now configured; current blocker is stale/expired `ide-url-0.txt` session URL causing HTTP failure)*

Run: `BENCH_RUNS=1 npx playwright test tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts --project=benchmark`

Expected: PASS + one raw result file under `test-data/benchmark/raw/`.

- [ ] **Step 8: Commit**

```bash
git add fixtures/utils/statistics.ts tests/ide/benchmark/Statistics.unit.spec.ts fixtures/utils/benchmark-metrics.ts tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts
git commit -m "feat(benchmark): add deterministic UI latency benchmark and stats helpers"
```

---

### Task 3: Add benchmark setup + aggregation (`theia-scale-tests`)

**Files:**
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/tests/setup/benchmark.setup.ts`
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/scripts/aggregate-benchmark.ts`
- Modify: `/Users/nikolas/BA Workdir/theia-scale-tests/package.json`
- Test: `/Users/nikolas/BA Workdir/theia-scale-tests/tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts`

- [ ] **Step 1: Write failing aggregate test (or script smoke check)**

If no unit-test harness for scripts exists, use smoke check:

Run: `node scripts/aggregate-benchmark.ts`

Expected: FAIL with explicit message when raw files missing.

- [ ] **Step 2: Implement benchmark.setup.ts**

Behavior:
- launch browser with stored auth
- go to landing page on test3
- launch `BENCH_TARGET_APP`
- wait `#/home/project`
- store URL into `test-data/benchmark/ide-url.txt`

- [ ] **Step 3: Implement aggregator script**

Output:
- `test-data/benchmark/summary.json`
- `test-data/benchmark/summary.csv`

Fields:
- architecture, mode, run_count, probe_count, median_latency_ms, p95_latency_ms, avg_latency_ms, max_latency_ms, startup_ms

- [ ] **Step 4: Add npm scripts**

```json
{
  "scripts": {
    "bench:ui": "playwright test --project=benchmark",
    "bench:aggregate": "node scripts/aggregate-benchmark.ts"
  }
}
```

- [ ] **Step 5: Run end-to-end benchmark smoke**

Run:
- `npx playwright test tests/setup/benchmark.setup.ts --project=benchmark`
- `BENCH_RUNS=3 npm run bench:ui`
- `npm run bench:aggregate`

Expected: benchmark raw files + summary files generated.

- [ ] **Step 6: Commit**

```bash
git add tests/setup/benchmark.setup.ts scripts/aggregate-benchmark.ts package.json
git commit -m "feat(benchmark): add benchmark setup and result aggregation"
```

---

### Task 4: Add local CI trigger + watch scripts (`EduIDE-deployment`)

**Files:**
- Create: `/Users/nikolas/BA Workdir/EduIDE-deployment/scripts/trigger-test3-deploy.sh`
- Create: `/Users/nikolas/BA Workdir/EduIDE-deployment/scripts/watch-test3-deploy.sh`
- Test: script dry-runs via `--help` and safe mode

- [ ] **Step 1: Write shell script contracts with `--help` and validation**

Required args:
- `--theia-cloud-tag`
- `--landing-page-tag` (optional)
- `--ide-images-tag`
- `--execution-mode` (`self-hosted-buildkit|github-runners`)

- [ ] **Step 2: Implement trigger script (manual workflow dispatch)**

Command pattern:

```bash
gh workflow run deploy-pr.yml \
  --repo EduIDE/EduIDE-deployment \
  -f theia_cloud_tag="$THEIA_CLOUD_TAG" \
  -f ide_images_tag="$IDE_IMAGES_TAG" \
  -f landing_page_tag="$LANDING_PAGE_TAG" \
  -f execution_mode="$EXECUTION_MODE"
```

- [ ] **Step 3: Implement watch script (GH run + rollout checks)**

Command pattern:

```bash
gh run watch "$RUN_ID" --repo EduIDE/EduIDE-deployment --interval 10 --exit-status
kubectl --context parma -n test3 rollout status deploy/operator-deployment --timeout=600s
kubectl --context parma -n test3 get pods
```

- [ ] **Step 4: Verify scripts in dry-run mode**

Run:
- `bash scripts/trigger-test3-deploy.sh --help`
- `bash scripts/watch-test3-deploy.sh --help`

Expected: usage text and non-error exit.

- [ ] **Step 5: Commit**

```bash
git add scripts/trigger-test3-deploy.sh scripts/watch-test3-deploy.sh
git commit -m "feat(ops): add test3 deploy trigger and watch scripts"
```

---

### Task 5: Add local `kubectl` resource monitor + orchestrator (`theia-scale-tests`)

**Files:**
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/scripts/monitor-test3-resources.sh`
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/scripts/run-test3-benchmark.sh`
- Modify: `/Users/nikolas/BA Workdir/theia-scale-tests/README.md`
- Test: monitor script output CSV

- [ ] **Step 1: Implement monitor script (polling every 1s)**

Output CSV columns:
- timestamp
- architecture
- ide_pod
- ide_cpu_millicores
- ide_mem_mib
- sidecar_pod
- sidecar_cpu_millicores
- sidecar_mem_mib
- combined_cpu_millicores
- combined_mem_mib

Internal mode: sidecar fields empty/zero and combined == IDE.

- [ ] **Step 2: Implement orchestrator script**

Flow:
1. Trigger deploy (optional flag)
2. Watch CI + rollout readiness
3. Start monitor script in background
4. Run Playwright benchmark with `BENCH_ARCH`, `BENCH_RUNS`, `BENCH_MODE`, `BENCH_PROBES`
5. Stop monitor script
6. Run aggregation
7. Emit final artifact paths

- [ ] **Step 3: Execute one architecture smoke run (test3)**

Run:

```bash
bash scripts/run-test3-benchmark.sh \
  --arch external \
  --runs 3 \
  --context parma \
  --namespace test3
```

Expected: latency summary (including mode/probe fields) + resource CSV produced.

- [ ] **Step 4: Commit**

```bash
git add scripts/monitor-test3-resources.sh scripts/run-test3-benchmark.sh README.md
git commit -m "feat(benchmark): add test3 resource monitor and benchmark orchestrator"
```

---

### Task 6: Comparative execution and report generation (cold + warm)

**Files:**
- Modify: `/Users/nikolas/BA Workdir/theia-scale-tests/scripts/aggregate-benchmark.ts`
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/test-data/benchmark/reports/compare-internal-vs-external.md` (generated artifact)
- Test: end-to-end two-architecture run

- [ ] **Step 1: Run internal benchmark series (cold then warm)**

```bash
bash scripts/run-test3-benchmark.sh --arch internal --mode cold --runs 30 --probes 3 --context parma --namespace test3
bash scripts/run-test3-benchmark.sh --arch internal --mode warm --runs 30 --probes 3 --context parma --namespace test3
```

Expected: internal cold+warm raw + summary + resource CSV.

- [ ] **Step 2: Run external benchmark series (cold then warm)**

```bash
bash scripts/run-test3-benchmark.sh --arch external --mode cold --runs 30 --probes 3 --context parma --namespace test3
bash scripts/run-test3-benchmark.sh --arch external --mode warm --runs 30 --probes 3 --context parma --namespace test3
```

Expected: external cold+warm raw + summary + resource CSV.

- [ ] **Step 3: Generate comparison table**

Output must include:
- latency median/p95/avg/max for each mode (`cold`, `warm`) and architecture (`internal`, `external`)
- startup-to-ready time per mode and architecture
- CPU/RAM avg and peak (internal IDE only vs external IDE+sidecar combined)

- [ ] **Step 4: Validate report consistency**

Checks:
- run counts equal target (`30` per architecture per mode)
- no missing rows
- no timeout-marked probes included in percentile set (or explicitly flagged)

- [ ] **Step 5: Commit**

```bash
git add scripts/aggregate-benchmark.ts test-data/benchmark/reports/compare-internal-vs-external.md
git commit -m "feat(benchmark): generate internal-vs-external comparison report"
```

---

### Task 7: Documentation hardening (thesis-ready reproducibility)

**Files:**
- Modify: `/Users/nikolas/BA Workdir/theia-scale-tests/README.md`
- Modify: `/Users/nikolas/BA Workdir/EduIDE-deployment/README.md`
- Create: `/Users/nikolas/BA Workdir/theia-scale-tests/docs/benchmark-test3-runbook.md`

- [ ] **Step 1: Document prerequisites**

Include:
- `gh auth status`
- `kubectl config use-context parma`
- access to `test3` namespace
- Keycloak credentials in `playwright.env`

- [ ] **Step 2: Document exact one-command flows**

Commands for:
- deploy + watch
- internal run
- external run
- aggregation and report extraction

- [ ] **Step 3: Document threats-to-validity controls**

Mandatory controls:
- single-worker benchmark
- deterministic file/edit operation
- fixed app/image tags
- fixed probes (`2–3`) and fixed timeout (`15s`)
- same cluster/namespace/time window where possible

- [ ] **Step 4: Commit**

```bash
git add README.md docs/benchmark-test3-runbook.md
git commit -m "docs(benchmark): add reproducible test3 runbook and validity controls"
```

---

## 4) End-to-end verification checklist

- [ ] `gh` authenticated and can dispatch workflow
- [ ] `kubectl` context set to `parma`
- [ ] `kubectl top pods -n test3` returns metrics
- [ ] test3 deployment ready after dispatch (`deploy-pr.yml` run green)
- [ ] Playwright benchmark project executes on test3 URL
- [ ] internal/external each have >= 20 valid runs
- [ ] final report includes median/p95 latency and avg/peak CPU+RAM

---

## 5) Guardrails (DRY, YAGNI, TDD)

- Reuse existing page objects (`TheiaTextEditor`, `TheiaProblemIndicator`) instead of adding duplicate selectors.
- Do not add protocol-level LSP instrumentation in this phase.
- Keep benchmark workload minimal (single deterministic syntax-error path).
- Keep scripts idempotent and explicit about context/namespace.

---

## 6) Suggested commit sequence

1. `feat(benchmark): add dedicated benchmark project and env contract`
2. `feat(benchmark): add deterministic UI latency benchmark and stats helpers`
3. `feat(benchmark): add benchmark setup and result aggregation`
4. `feat(ops): add test3 deploy trigger and watch scripts`
5. `feat(benchmark): add test3 resource monitor and benchmark orchestrator`
6. `feat(benchmark): generate internal-vs-external comparison report`
7. `docs(benchmark): add reproducible test3 runbook and validity controls`

---

## 7) Minimal command cheat sheet (operator)

```bash
# 1) Trigger deploy to test3 with explicit tags
gh workflow run deploy-pr.yml --repo EduIDE/EduIDE-deployment \
  -f theia_cloud_tag=pr-70 \
  -f ide_images_tag=pr-70 \
  -f landing_page_tag=pr-70 \
  -f execution_mode=self-hosted-buildkit

# 2) Watch latest run
gh run list --repo EduIDE/EduIDE-deployment --workflow deploy-pr.yml --limit 1
gh run watch <RUN_ID> --repo EduIDE/EduIDE-deployment --interval 10 --exit-status

# 3) Verify rollout and pods
kubectl --context parma -n test3 get pods
kubectl --context parma -n test3 rollout status deployment/operator-deployment --timeout=600s

# 4) Execute benchmark (external warm example)
cd /Users/nikolas/BA Workdir/theia-scale-tests
BENCH_ARCH=external BENCH_MODE=warm BENCH_RUNS=30 BENCH_PROBES=3 BENCH_PROBE_TIMEOUT_MS=15000 npx playwright test --project=benchmark
node scripts/aggregate-benchmark.ts
```
