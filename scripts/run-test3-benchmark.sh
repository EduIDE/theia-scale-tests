#!/usr/bin/env bash
set -euo pipefail

if [[ -x /opt/homebrew/bin/bash ]]; then
  BASH_BIN=/opt/homebrew/bin/bash
elif [[ -x /usr/local/bin/bash ]]; then
  BASH_BIN=/usr/local/bin/bash
else
  BASH_BIN=bash
fi

usage() {
  cat <<'EOF'
Usage: run-test3-benchmark.sh --context <ctx> --namespace <ns> --target-app <app> --arch <name> [options]

Options:
  --mode <name>            Benchmark mode label, default warm
  --scenario <name>        Benchmark scenario label, default simple-type-error
  --runs <count>           Number of independent benchmark runs, default 1
  --probes <count>         Warm probes per run, default 5
  --output-dir <path>      Output directory, default test-data/benchmark
  --interval <seconds>     Resource polling interval, default 1
  --settle <seconds>       Extra wait for final Prometheus scrape, default 6
  --headed                 Run Playwright headed
EOF
}

KUBE_CONTEXT=""
NAMESPACE=""
TARGET_APP=""
ARCHITECTURE=""
MODE="warm"
SCENARIO="${BENCH_SCENARIO:-simple-type-error}"
RUNS=1
PROBES=5
OUTPUT_DIR="${BENCH_OUTPUT_DIR:-test-data/benchmark}"
INTERVAL_SECONDS=1
SETTLE_SECONDS=6
HEADED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context)
      KUBE_CONTEXT="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --target-app)
      TARGET_APP="$2"
      shift 2
      ;;
    --arch)
      ARCHITECTURE="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --runs)
      RUNS="$2"
      shift 2
      ;;
    --probes)
      PROBES="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --interval)
      INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --settle)
      SETTLE_SECONDS="$2"
      shift 2
      ;;
    --headed)
      HEADED=1
      shift 1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$KUBE_CONTEXT" || -z "$NAMESPACE" || -z "$TARGET_APP" || -z "$ARCHITECTURE" ]]; then
  echo "--context, --namespace, --target-app, and --arch are required" >&2
  usage >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}/raw"
PLAYWRIGHT_ARGS=(tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts --project=benchmark --workers=1 --reporter=line --no-deps --retries=0)
if [[ "$HEADED" -eq 1 ]]; then
  PLAYWRIGHT_ARGS+=(--headed)
fi

for (( run_number=1; run_number<=RUNS; run_number++ )); do
  run_suffix="$(printf 'run-%02d' "$run_number")"
  timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  run_id="${ARCHITECTURE}-${MODE}-${SCENARIO}-${run_suffix}-${timestamp}"
  echo "Starting benchmark ${run_id} for ${TARGET_APP}"

  "$BASH_BIN" scripts/monitor-test3-resources.sh \
    --context "$KUBE_CONTEXT" \
    --namespace "$NAMESPACE" \
    --target-app "$TARGET_APP" \
    --architecture "$ARCHITECTURE" \
    --mode "$MODE" \
    --scenario "$SCENARIO" \
    --run-id "$run_id" \
    --output-dir "$OUTPUT_DIR" \
    --interval "$INTERVAL_SECONDS" &
  monitor_pid=$!

  cleanup_monitor() {
    if kill -0 "$monitor_pid" >/dev/null 2>&1; then
      kill "$monitor_pid" >/dev/null 2>&1 || true
      wait "$monitor_pid" >/dev/null 2>&1 || true
    fi
  }

  trap cleanup_monitor EXIT

  BENCH_ARCH="$ARCHITECTURE" \
  BENCH_MODE="$MODE" \
  BENCH_SCENARIO="$SCENARIO" \
  BENCH_RUN_NUMBER="$run_number" \
  BENCH_RUN_ID="$run_id" \
  BENCH_TARGET_APP="$TARGET_APP" \
  BENCH_PROBES="$PROBES" \
  BENCH_OUTPUT_DIR="$OUTPUT_DIR" \
  npx playwright test "${PLAYWRIGHT_ARGS[@]}"

  sleep "$SETTLE_SECONDS"
  cleanup_monitor
  trap - EXIT
done

node scripts/aggregate-benchmark.mjs --output-dir "$OUTPUT_DIR"
