#!/usr/bin/env bash
# Resolve an EduIDE environment name to its landing page URL.
#
#   ./scripts/env-url.sh test2          -> https://test2.eduide.student.k8s.aet.cit.tum.de
#   ./scripts/env-url.sh test2 service  -> https://service.test2.eduide.student.k8s.aet.cit.tum.de
#
# The environments are described once, in EduIDE-deployment. Hardcoding a URL
# here is how the suite ended up pointing only at production, with
# keycloak.ase.in.tum.de asserted in one spec and theia.artemis.cit.tum.de in
# another.
#
# Set EDUIDE_DEPLOYMENT to the checkout, or let it look next door.

set -euo pipefail

ENV_NAME="${1:?usage: env-url.sh <environment> [landing|service|instance]}"
WHAT="${2:-landing}"

DEPLOY="${EDUIDE_DEPLOYMENT:-}"
if [[ -z "$DEPLOY" ]]; then
  for c in ../EduIDE-deployment ../../EduIDE-deployment ./EduIDE-deployment; do
    [[ -d "$c/environments" ]] && { DEPLOY="$c"; break; }
  done
fi
if [[ ! -d "${DEPLOY:-/nonexistent}/environments" ]]; then
  if [[ -d "${DEPLOY:-/nonexistent}/deployments" ]]; then
    # Found the repo, but it predates the environment manifests.
    echo "This EduIDE-deployment checkout has no environments/ directory." >&2
    echo "It still carries the pre-restructure deployments/ layout, so there is" >&2
    echo "nothing to resolve. Merge EduIDE-deployment#113 first." >&2
  else
    echo "Cannot find EduIDE-deployment. Set EDUIDE_DEPLOYMENT to the checkout." >&2
  fi
  exit 2
fi

M="$DEPLOY/environments/$ENV_NAME/env.yaml"
if [[ ! -f "$M" ]]; then
  echo "No such environment: $ENV_NAME" >&2
  avail=$(for d in "$DEPLOY"/environments/*/; do basename "$d"; done | sort | paste -sd' ' -)
  echo "Available: $avail" >&2
  exit 2
fi

# Hosts are in values.yaml, not env.yaml. The two files split by what reads
# them: env.yaml configures the deploy, values.yaml configures the chart, and a
# hostname is chart configuration. Reading them from env.yaml returns null and
# builds "https://null.null".
V="$DEPLOY/environments/$ENV_NAME/values.yaml"
if [[ ! -f "$V" ]]; then
  echo "No values.yaml for environment: $ENV_NAME" >&2
  exit 2
fi

base=$(yq -r '.hosts.configuration.baseHost' "$V")
case "$WHAT" in
  landing)  host=$(yq -r '.hosts.configuration.landing' "$V") ;;
  service)  host=$(yq -r '.hosts.configuration.service // ("service." + .hosts.configuration.landing)' "$V") ;;
  instance) host=$(yq -r '.hosts.configuration.instance // ("instance." + .hosts.configuration.landing)' "$V") ;;
  *) echo "unknown component: $WHAT" >&2; exit 2 ;;
esac

if [[ -z "$base" || "$base" == "null" || -z "$host" || "$host" == "null" ]]; then
  echo "Could not read hosts.configuration from $V" >&2
  echo "Expected hosts.configuration.{baseHost,landing,service,instance}." >&2
  exit 2
fi

echo "https://${host}.${base}"
