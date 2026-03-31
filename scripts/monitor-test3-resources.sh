#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: monitor-test3-resources.sh --namespace <ns> --target-app <app> [options]

Options:
  --context <name>         kubectl context to use
  --namespace <name>       Kubernetes namespace to monitor
  --target-app <name>      App definition name, for example java-17-latest
  --architecture <name>    internal | external
  --mode <name>            cold | warm
  --scenario <name>        Benchmark scenario label
  --run-id <id>            Stable benchmark run id
  --output-dir <path>      Benchmark output directory, default test-data/benchmark
  --interval <seconds>     Polling interval, default 1
  --prom-namespace <name>  Prometheus namespace, default cattle-monitoring-system
  --prom-service <name>    Prometheus service, default rancher-monitoring-prometheus
EOF
}

KUBE_CONTEXT=""
NAMESPACE=""
TARGET_APP=""
ARCHITECTURE="${BENCH_ARCH:-unknown}"
MODE="${BENCH_MODE:-unknown}"
SCENARIO="${BENCH_SCENARIO:-simple-type-error}"
RUN_ID="${BENCH_RUN_ID:-manual-run}"
OUTPUT_DIR="${BENCH_OUTPUT_DIR:-test-data/benchmark}"
INTERVAL_SECONDS=1
PROM_NAMESPACE="cattle-monitoring-system"
PROM_SERVICE="rancher-monitoring-prometheus"

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
    --architecture)
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
    --run-id)
      RUN_ID="$2"
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
    --prom-namespace)
      PROM_NAMESPACE="$2"
      shift 2
      ;;
    --prom-service)
      PROM_SERVICE="$2"
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

if [[ -z "$NAMESPACE" || -z "$TARGET_APP" ]]; then
  echo "--namespace and --target-app are required" >&2
  usage >&2
  exit 1
fi

RAW_DIR="${OUTPUT_DIR}/raw"
RESOURCE_FILE="${RAW_DIR}/resource-raw.csv"
mkdir -p "$RAW_DIR"

if [[ ! -f "$RESOURCE_FILE" ]]; then
  printf '%s\n' 'timestamp,run_id,architecture,mode,scenario,target_app,pod,container,role,cpu_raw,memory_raw,metric_timestamp,source' > "$RESOURCE_FILE"
fi

KUBECTL_ARGS=()
if [[ -n "$KUBE_CONTEXT" ]]; then
  KUBECTL_ARGS+=(--context "$KUBE_CONTEXT")
fi
KUBECTL_ARGS+=(-n "$NAMESPACE")

PROMETHEUS_RAW_PATH="/api/v1/namespaces/${PROM_NAMESPACE}/services/http:${PROM_SERVICE}:9090/proxy/api/v1/query"

BASELINE_IDE_PODS="$(kubectl "${KUBECTL_ARGS[@]}" get pod -l "app.kubernetes.io/component=session,theia-cloud.io/app-definition=${TARGET_APP}" -o name 2>/dev/null || true)"
BASELINE_SIDECAR_PODS="$(kubectl "${KUBECTL_ARGS[@]}" get pod -l "theia-cloud.io/sidecar" -o name 2>/dev/null || true)"

declare -A LAST_RECORDED_SAMPLE_TS=()

contains_line() {
  local haystack="$1"
  local needle="$2"
  if [[ -z "$haystack" ]]; then
    return 1
  fi
  grep -Fxq "$needle" <<<"$haystack"
}

current_targets() {
  local ide_now sidecar_now targets=""
  ide_now="$(kubectl "${KUBECTL_ARGS[@]}" get pod -l "app.kubernetes.io/component=session,theia-cloud.io/app-definition=${TARGET_APP}" -o name 2>/dev/null || true)"
  while IFS= read -r pod; do
    [[ -z "$pod" ]] && continue
    if ! contains_line "$BASELINE_IDE_PODS" "$pod"; then
      targets+="${pod#pod/},ide"$'\n'
    fi
  done <<<"$ide_now"

  if [[ "$ARCHITECTURE" == "external" ]]; then
    sidecar_now="$(kubectl "${KUBECTL_ARGS[@]}" get pod -l "theia-cloud.io/sidecar" -o name 2>/dev/null || true)"
    while IFS= read -r pod; do
      [[ -z "$pod" ]] && continue
      if ! contains_line "$BASELINE_SIDECAR_PODS" "$pod"; then
        targets+="${pod#pod/},sidecar"$'\n'
      fi
    done <<<"$sidecar_now"
  fi

  printf '%s' "$targets"
}

prom_query() {
  local query="$1"
  local encoded
  local response
  encoded="$(jq -nr --arg q "$query" '$q|@uri')"
  response="$(kubectl "${KUBECTL_ARGS[@]:0:${#KUBECTL_ARGS[@]}-2}" get --raw "${PROMETHEUS_RAW_PATH}?query=${encoded}" 2>/dev/null || true)"
  if [[ -z "$response" ]] || ! jq -e . >/dev/null 2>&1 <<<"$response"; then
    printf '%s' '{"status":"success","data":{"resultType":"vector","result":[]}}'
    return 0
  fi
  printf '%s' "$response"
}

metric_timestamp_to_iso() {
  local metric_timestamp="$1"
  local seconds="${metric_timestamp%.*}"
  date -u -r "$seconds" +"%Y-%m-%dT%H:%M:%SZ"
}

trap 'exit 0' INT TERM

while true; do
  TARGETS="$(current_targets)"
  if [[ -n "$TARGETS" ]]; then
    unset ROLE_BY_POD MEMORY_BY_KEY CPU_BY_KEY SAMPLE_TS_BY_KEY
    declare -A ROLE_BY_POD=()
    declare -A MEMORY_BY_KEY=()
    declare -A CPU_BY_KEY=()
    declare -A SAMPLE_TS_BY_KEY=()
    TARGET_PODS=()

    while IFS=, read -r pod_name role; do
      [[ -z "$pod_name" ]] && continue
      ROLE_BY_POD["$pod_name"]="$role"
      TARGET_PODS+=("$pod_name")
    done <<<"$TARGETS"

    if [[ "${#TARGET_PODS[@]}" -gt 0 ]]; then
      pod_regex="$(printf '%s\n' "${TARGET_PODS[@]}" | paste -sd'|' -)"

      memory_query="sum by (pod,container) (container_memory_working_set_bytes{namespace=\"${NAMESPACE}\",pod=~\"(${pod_regex})\",container!=\"\",image!=\"\"})"
      cpu_query="sum by (pod,container) (rate(container_cpu_usage_seconds_total{namespace=\"${NAMESPACE}\",pod=~\"(${pod_regex})\",container!=\"\",image!=\"\"}[20s])) * 1000"
      timestamp_query="timestamp(${memory_query})"

      MEMORY_JSON="$(prom_query "$memory_query")"
      CPU_JSON="$(prom_query "$cpu_query")"
      TIMESTAMP_JSON="$(prom_query "$timestamp_query")"

      while IFS=$'\t' read -r pod_name container_name memory_bytes; do
        [[ -z "$pod_name" || -z "$container_name" ]] && continue
        MEMORY_BY_KEY["${pod_name}|${container_name}"]="$memory_bytes"
      done < <(
        jq -r '.data.result[]? | [.metric.pod, .metric.container, .value[1]] | @tsv' <<<"$MEMORY_JSON"
      )

      while IFS=$'\t' read -r pod_name container_name cpu_millicores; do
        [[ -z "$pod_name" || -z "$container_name" ]] && continue
        CPU_BY_KEY["${pod_name}|${container_name}"]="$cpu_millicores"
      done < <(
        jq -r '.data.result[]? | [.metric.pod, .metric.container, .value[1]] | @tsv' <<<"$CPU_JSON"
      )

      while IFS=$'\t' read -r pod_name container_name sample_timestamp; do
        [[ -z "$pod_name" || -z "$container_name" || -z "$sample_timestamp" ]] && continue
        SAMPLE_TS_BY_KEY["${pod_name}|${container_name}"]="$sample_timestamp"
      done < <(
        jq -r '.data.result[]? | [.metric.pod, .metric.container, .value[1]] | @tsv' <<<"$TIMESTAMP_JSON"
      )

      for key in "${!MEMORY_BY_KEY[@]}"; do
        pod_name="${key%%|*}"
        container_name="${key#*|}"
        role="${ROLE_BY_POD[$pod_name]:-}"
        sample_timestamp="${SAMPLE_TS_BY_KEY[$key]:-}"
        [[ -z "$role" || -z "$sample_timestamp" ]] && continue
        if [[ "${LAST_RECORDED_SAMPLE_TS[$key]:-}" == "$sample_timestamp" ]]; then
          continue
        fi

        memory_bytes="${MEMORY_BY_KEY[$key]}"
        cpu_millicores="${CPU_BY_KEY[$key]:-0}"
        timestamp_iso="$(metric_timestamp_to_iso "$sample_timestamp")"
        cpu_raw="${cpu_millicores}m"
        memory_raw="$(jq -nr --arg bytes "$memory_bytes" '($bytes|tonumber) / 1048576 | tostring + "Mi"')"

        printf '%s\n' "${timestamp_iso},${RUN_ID},${ARCHITECTURE},${MODE},${SCENARIO},${TARGET_APP},${pod_name},${container_name},${role},${cpu_raw},${memory_raw},${sample_timestamp},prometheus" >> "$RESOURCE_FILE"
        LAST_RECORDED_SAMPLE_TS["$key"]="$sample_timestamp"
      done
    fi
  fi
  sleep "$INTERVAL_SECONDS"
done
