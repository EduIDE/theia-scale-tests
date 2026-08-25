#!/usr/bin/env bash
# Resolve an EduIDE environment name to its landing page URL.
#
#   ./scripts/env-url.sh test2          -> https://test2.theia-test.artemis.cit.tum.de
#   ./scripts/env-url.sh test2 service  -> https://service.test2.theia-test.artemis.cit.tum.de
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
  echo "Cannot find EduIDE-deployment. Set EDUIDE_DEPLOYMENT to the checkout." >&2
  exit 2
fi

M="$DEPLOY/environments/$ENV_NAME/env.yaml"
if [[ ! -f "$M" ]]; then
  echo "No such environment: $ENV_NAME" >&2
  avail=$(for d in "$DEPLOY"/environments/*/; do basename "$d"; done | sort | paste -sd' ' -)
  echo "Available: $avail" >&2
  exit 2
fi

base=$(yq -r '.spec.hosts.baseHost' "$M")
case "$WHAT" in
  landing)  host=$(yq -r '.spec.hosts.landing' "$M") ;;
  service)  host=$(yq -r '.spec.hosts.service // ("service." + .spec.hosts.landing)' "$M") ;;
  instance) host=$(yq -r '.spec.hosts.instance // ("instance." + .spec.hosts.landing)' "$M") ;;
  *) echo "unknown component: $WHAT" >&2; exit 2 ;;
esac

echo "https://${host}.${base}"
