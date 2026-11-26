# Startup bench

Measures how fast an IDE session starts on different control planes with the same image.
The harness creates the session CR directly, watches the CR and the pod, probes the public route, loads the workbench in a headless browser through a port-forward and deletes the session again.

Milestones (ms after the CR was created): `scheduled`, `running`, `podReady`, `url`, `controlPlaneReady`, `routed` (public URL answers differently than a path without a session), `routeAccepted` (gateway accepted the session HTTPRoute), `http200`, `shell`, `explorer`.
Per run it also records cleanup time, pool refill time (warm), created objects, control plane CPU and memory, and whether the node pulled the image.

## Setup

- `kubectl` with a `stud` context, Node 22 or newer, `npm install`
- A Chromium headless shell, for example from `npx playwright install chromium-headless-shell`, passed as `CHROME_PATH`
- The bench objects in `setup/`: the AppDefinition for test2, the IDETemplate for test3, the pre-pull DaemonSet, and for upstream the Helm values (chart `theia-cloud` 1.2.0 from https://eclipse-theia.github.io/theia-cloud-helm), AppDefinition, ingress Role and pre-pull DaemonSet
- Variants: `eduide-cloud` (test2), `go` (test3), `upstream` (namespace `eduide-upstream`; cold needs `operator.eagerStart: false`, warm needs `true`, see results/REPORT.md for the extra setup)

## Run

```bash
npm test                                     # pure helpers
node bench.mjs --variant go --mode cold --runs 1 --out /tmp/dry.jsonl
./series.sh go 4 5 results/go.jsonl          # 4 blocks of 5 cold and 5 warm starts
node report.mjs results/*.jsonl > report.md
```

Results of 2026-11-20: [results/REPORT.md](results/REPORT.md).
