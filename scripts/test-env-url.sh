#!/usr/bin/env bash
# env-url.sh reads hostnames out of EduIDE-deployment. It has already been wrong
# twice about which file they live in: they moved from env.yaml to values.yaml
# when the manifests split by what reads them - env.yaml configures the deploy,
# values.yaml configures the chart, and a hostname is chart configuration.
#
# yq returns null for a missing key rather than failing, so the wrong path
# yields "https://null.null" and the suite runs against a host that does not
# exist. This asserts the shape instead of trusting it.
#
# Point EDUIDE_DEPLOYMENT at a checkout, or it looks next door.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
ok()  { printf '  PASS  %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; FAILED=1; }

DEPLOY="${EDUIDE_DEPLOYMENT:-}"
if [[ -z "$DEPLOY" ]]; then
  for c in ../EduIDE-deployment ../../EduIDE-deployment ./EduIDE-deployment; do
    [[ -d "$c/environments" ]] && { DEPLOY="$(cd "$c" && pwd)"; break; }
  done
fi
if [[ ! -d "${DEPLOY:-/nonexistent}/environments" ]]; then
  echo "  SKIP  no EduIDE-deployment checkout with environments/ (set EDUIDE_DEPLOYMENT)"
  exit 0
fi
export EDUIDE_DEPLOYMENT="$DEPLOY"

echo "=== every environment resolves to a real hostname ==="
for d in "$DEPLOY"/environments/*/; do
  env_name="$(basename "$d")"
  [[ -f "$d/values.yaml" ]] || continue
  for what in landing service instance; do
    url="$("$ROOT/scripts/env-url.sh" "$env_name" "$what" 2>&1)" || {
      bad "$env_name/$what did not resolve" "$url"; continue; }
    case "$url" in
      *null*)        bad "$env_name/$what resolved to a null segment" "$url" ;;
      https://*.*.*) : ;;   # host plus a domain with at least one dot
      *)             bad "$env_name/$what is not a plausible URL" "$url" ;;
    esac
  done
  ok "$env_name -> $("$ROOT/scripts/env-url.sh" "$env_name")"
done

echo
echo "=== failure modes are legible ==="
if out=$("$ROOT/scripts/env-url.sh" no-such-env 2>&1); then
  bad "an unknown environment should not succeed" "$out"
else
  case "$out" in
    *"No such environment"*) ok "unknown environment names itself" ;;
    *) bad "unknown environment gave an unhelpful error" "$out" ;;
  esac
fi

if out=$(EDUIDE_DEPLOYMENT=/nonexistent "$ROOT/scripts/env-url.sh" test1 2>&1); then
  bad "a missing checkout should not succeed" "$out"
else
  ok "missing checkout is reported"
fi

echo
[[ $FAILED -eq 0 ]] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAILED
