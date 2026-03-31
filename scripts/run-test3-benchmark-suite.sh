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
Usage: run-test3-benchmark-suite.sh --context <ctx> --namespace <ns> --target-app <app> --arch <name> [options]

Options:
  --mode <name>             Benchmark mode label, default warm
  --suite-runs <count>      Number of outer suite runs, default 1
  --probes <count>          Warm probes per scenario run, default 3
  --output-dir <path>       Base output directory, default test-data/benchmark-suite
  --image-type <label>      Extra grouping label for the tested deployment/image variant
  --scenarios <csv>         Scenario order, default simple-type-error,import-semantic-error,hover-context
  --interval <seconds>      Resource polling interval passed through to run-test3-benchmark.sh
  --settle <seconds>        Final scrape settle time passed through, default 6
  --landing-url <url>       Landing page URL for network preflight, default https://<namespace>.theia-test.artemis.cit.tum.de/
  --headed                  Run Playwright headed
EOF
}

KUBE_CONTEXT=""
NAMESPACE=""
TARGET_APP=""
ARCHITECTURE=""
MODE="warm"
SUITE_RUNS="${BENCH_SUITE_RUNS:-1}"
PROBES="${BENCH_PROBES:-3}"
OUTPUT_DIR="${BENCH_SUITE_OUTPUT_DIR:-test-data/benchmark-suite}"
IMAGE_TYPE="${BENCH_IMAGE_TYPE:-default}"
SCENARIOS_CSV="${BENCH_SUITE_SCENARIOS:-simple-type-error,import-semantic-error,hover-context}"
INTERVAL_SECONDS=1
SETTLE_SECONDS=6
HEADED=0
PROM_NAMESPACE="cattle-monitoring-system"
PROM_SERVICE="rancher-monitoring-prometheus"
LANDING_URL="${LANDINGPAGE_URL:-}"

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
    --suite-runs)
      SUITE_RUNS="$2"
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
    --image-type)
      IMAGE_TYPE="$2"
      shift 2
      ;;
    --scenarios)
      SCENARIOS_CSV="$2"
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
    --prom-namespace)
      PROM_NAMESPACE="$2"
      shift 2
      ;;
    --prom-service)
      PROM_SERVICE="$2"
      shift 2
      ;;
    --landing-url)
      LANDING_URL="$2"
      shift 2
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

IFS=',' read -r -a SCENARIOS <<<"$SCENARIOS_CSV"
if [[ "${#SCENARIOS[@]}" -eq 0 ]]; then
  echo "At least one scenario is required" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
SUITE_ROOT="${OUTPUT_DIR}/${TARGET_APP}/${IMAGE_TYPE}"
mkdir -p "$SUITE_ROOT"

if [[ -z "$LANDING_URL" ]]; then
  LANDING_URL="https://${NAMESPACE}.theia-test.artemis.cit.tum.de/"
fi

KUBECTL_ARGS=()
if [[ -n "$KUBE_CONTEXT" ]]; then
  KUBECTL_ARGS+=(--context "$KUBE_CONTEXT")
fi
PROM_QUERY_PATH="/api/v1/namespaces/${PROM_NAMESPACE}/services/http:${PROM_SERVICE}:9090/proxy/api/v1/query"

prom_query() {
  local query="$1"
  local encoded
  encoded="$(jq -nr --arg q "$query" '$q|@uri')"
  kubectl "${KUBECTL_ARGS[@]}" get --raw "${PROM_QUERY_PATH}?query=${encoded}"
}

echo "Prometheus preflight for ${TARGET_APP}/${IMAGE_TYPE}"
prom_up_json="$(prom_query "up" 2>/dev/null || true)"
if [[ -z "$prom_up_json" ]] || ! jq -e '.status == "success"' >/dev/null 2>&1 <<<"$prom_up_json"; then
  echo "Prometheus preflight failed: query endpoint not reachable or invalid response" >&2
  exit 1
fi

cadvisor_json="$(prom_query "count(container_memory_working_set_bytes{namespace=\"${NAMESPACE}\"})" 2>/dev/null || true)"
if [[ -z "$cadvisor_json" ]] || ! jq -e '.status == "success"' >/dev/null 2>&1 <<<"$cadvisor_json"; then
  echo "Prometheus preflight failed: cAdvisor metrics query did not return success" >&2
  exit 1
fi

printf '%s\n' "$prom_up_json" > "${SUITE_ROOT}/prometheus-up.json"
printf '%s\n' "$cadvisor_json" > "${SUITE_ROOT}/prometheus-cadvisor-count.json"
{
  echo "target=${LANDING_URL}"
  for attempt in 1 2 3 4 5; do
    curl -ksS -o /dev/null \
      -w "attempt=${attempt} http_code=%{http_code} remote_ip=%{remote_ip} time_namelookup=%{time_namelookup} time_connect=%{time_connect} time_appconnect=%{time_appconnect} time_starttransfer=%{time_starttransfer} time_total=%{time_total}\\n" \
      "${LANDING_URL}"
  done
} > "${SUITE_ROOT}/network-curl-preflight.txt"
cat > "${SUITE_ROOT}/suite-metadata.json" <<EOF
{
  "targetApp": "${TARGET_APP}",
  "imageType": "${IMAGE_TYPE}",
  "architecture": "${ARCHITECTURE}",
  "mode": "${MODE}",
  "suiteRuns": ${SUITE_RUNS},
  "probes": ${PROBES},
  "scenarios": "$(printf '%s' "$SCENARIOS_CSV")",
  "landingUrl": "${LANDING_URL}"
}
EOF

for (( suite_run=1; suite_run<=SUITE_RUNS; suite_run++ )); do
  suite_dir="${SUITE_ROOT}/run-$(printf '%02d' "$suite_run")"
  mkdir -p "$suite_dir"
  echo "Starting suite run $(printf '%02d' "$suite_run") for ${TARGET_APP} (${IMAGE_TYPE}, ${ARCHITECTURE}/${MODE})"

  for scenario in "${SCENARIOS[@]}"; do
    scenario_dir="${suite_dir}/${scenario}"
    echo "  Scenario ${scenario} -> ${scenario_dir}"
    cmd=(
      "$BASH_BIN" scripts/run-test3-benchmark.sh
      --context "$KUBE_CONTEXT"
      --namespace "$NAMESPACE"
      --target-app "$TARGET_APP"
      --arch "$ARCHITECTURE"
      --mode "$MODE"
      --scenario "$scenario"
      --runs 1
      --probes "$PROBES"
      --output-dir "$scenario_dir"
      --interval "$INTERVAL_SECONDS"
      --settle "$SETTLE_SECONDS"
    )
    if [[ "$HEADED" -eq 1 ]]; then
      cmd+=(--headed)
    fi
    "${cmd[@]}"
  done
done
