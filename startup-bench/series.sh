#!/usr/bin/env bash
# Runs a benchmark series for one variant: blocks of cold and warm starts, alternating, so both
# modes see the same cluster conditions over time.
# Usage: ./series.sh <variant> <blocks> <runs-per-block> <out.jsonl>
set -euo pipefail
variant=$1 blocks=$2 per=$3 out=$4
cd "$(dirname "$0")"
for b in $(seq 1 "$blocks"); do
  for mode in cold warm; do
    node bench.mjs --variant "$variant" --mode "$mode" --runs "$per" --gap 30 --out "$out"
  done
done
node bench.mjs --variant "$variant" --mode cold --runs 0 --out /dev/null # leaves the pool at 0
