# Theia Scale Tests

[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/functional-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/functional-tests.yml)
[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/scalable-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/scalable-tests.yml)
[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artillery-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml)
[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml)

---

This repository provides E2E integration tests for the [Theia Cloud IDE](https://theia-cloud.io). It uses Playwright to simulate real world usage of Online IDE's in large classroom settings.

## Information

- Tests are written using [Playwright](https://playwright.dev)
- Scaled tests run via the Playwright [Artillery](https://artillery.io) Framework or natively only using Playwright
- Make sure, that Sessions per User and max instanecs per App Definition is high enough set on the cluster!

## Setup

- Setup Envionment Variables
  - Duplicate `playwright.env.template` and rename it to `playwright.env` (make sure this file is gitignored!)
  - Fill in the given variables as described in the file, notice:
    - Keycloak User and Password needs to have access to Theia (does not need to be the same Artemis User as of now)
    - Landing Page URL is the URL of the Theia Deployment to test against (this does not affect the Artemis Integration test, as the target deployment is set by Artemis)
    - The Artemis User needs to have enough priviliges to create a course and exercise on the given test server

- Get the latest Theia IDE image from [here](https://ghcr.io/eclipse-theia/theia-ide/theia-ide:latest) and run it. Put the corresponding URL into the env file

- Install dependencies and playwright browser
  ```bash
  pnpm install
  ```
  ```bash
  pnpm exec playwright install
  ```

## Run Tests

- To run the functional tests on the deployed Theia instance, run:
  ```bash
  pnpm exec playwright test --project=functional
  ```
- To run tests locally using a Theia Instance on localhost, change the environment variable to the corresponding port and run the tests using:

  ```bash
  pnpm exec playwright test --project=local
  ```

- To run the load tests, run:

  > **_NOTE:_**
  As load tests use a single account, pay attention that the session per user limit is min the amount of instances you want!


  ```bash
  pnpm exec playwright test --project=scale
  ```

  Set the amount of instances in the ENV file or pass it like this (ex. 100 instances):

  ```bash
  NUM_INSTANCE=100 pnpm exec playwright test --project=scale
  ```

  To run the tests using the Artillery.io framework, run:

  ```bash
  pnpm exec artillery run tests/ide/scalable/artillery/Artillery.ts
  ```

- To run the MCP tests, follow the README in the [**MCP**](mcp/README.md) folder

- To run the benchmark manually for one flavour, run:

  ```bash
  BENCH_TARGET_APP=java-17-no-ls BENCH_ARCH=external BENCH_MODE=warm BENCH_SCENARIO=simple-type-error pnpm exec playwright test tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts --project=benchmark --headed --workers=1 --reporter=line --no-deps --retries=0
  ```

  Optional benchmark env vars:
  - `BENCH_SCENARIO=simple-type-error`
    Selects the benchmark scenario. Supported values are `simple-type-error`, `import-semantic-error`, and `hover-context`.
  - `BENCH_HELPER_FILE=src/bench/BenchHelper.java`
    Helper file path used by the semantic-import and hover scenarios.
  - `BENCH_POST_ERROR_SETTLE_MS=2000`
    Adds a short delay after a squiggly/diagnostic appears before the benchmark continues with the next step. The latency itself is still measured at first appearance.
  - `BENCH_HOVER_WARMUP_MS=45000`
    Adds a fixed warmup wait before hover measurements start so the language server can finish initial project setup.
  - `BENCH_HOVER_RESOLVE_TIMEOUT_MS=15000`
    Hover measurements wait for real hover content up to this timeout. `Loading...` does not count as a result.

  Scenario notes:
  - `simple-type-error`
    Uses two imports and injects a local type mismatch (`int = "x"`).
  - `import-semantic-error`
    Uses a project-local imported helper class and injects a semantic type mismatch based on the imported method result.
  - `hover-context`
    Uses the same imported helper class and measures how fast resolved Monaco hover content appears for three fixed tokens (`ArrayList`, `BenchHelper`, `compute`). A temporary `Loading...` tooltip is ignored.
  - The benchmark setup initializes a minimal Eclipse/JDT Java project in the workspace via terminal before creating the scenario files (`.project`, `.classpath`, `.settings/org.eclipse.jdt.core.prefs`).

- To improve resource metric freshness for the benchmark on `theia-prod`, temporarily lower the Prometheus kubelet cAdvisor scrape interval to `5s`:

  ```bash
  kubectl --context theia-prod -n cattle-monitoring-system patch servicemonitor rancher-monitoring-kubelet --type='json' -p='[{"op":"add","path":"/spec/endpoints/1/interval","value":"5s"}]'
  ```

  Verify that Prometheus picked it up:

  ```bash
  kubectl --context theia-prod get --raw '/api/v1/namespaces/cattle-monitoring-system/services/http:rancher-monitoring-prometheus:9090/proxy/api/v1/status/config' | jq -r '.data.yaml' | sed -n '1598,1622p'
  ```

  Revert after the benchmark campaign:

  ```bash
  kubectl --context theia-prod -n cattle-monitoring-system patch servicemonitor rancher-monitoring-kubelet --type='json' -p='[{"op":"replace","path":"/spec/endpoints/1/interval","value":"15s"}]'
  ```

- To aggregate benchmark artifacts in `test-data/benchmark`, run:

  ```bash
  pnpm run bench:aggregate
  ```

- To run the benchmark with Prometheus-backed resource monitoring against a deployed namespace, run:

  ```bash
  bash scripts/run-benchmark.sh --context <kube-context> --namespace <namespace> --target-app java-17-no-ls --arch external --mode warm --scenario import-semantic-error --runs 1 --probes 5 --headed
  ```

  The resource collector reads container CPU and memory from Prometheus cAdvisor metrics and stores them in `test-data/.../raw/resource-raw.csv`.

  If the benchmark setup is hard to reproduce from this cleaned test-suite branch, compare against the development branch `feature/benchmark-test3-ui-latency`, which contains the original local benchmark campaign state and debugging history.

| Project Identifier | Description                                                                                                       | Status                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| local              | Runs all **functional** tests on a local instance, provided by the URL in the env file.                           |                                                                                                                                                                                                                               |
| functional         | Runs all **functional** tests on the deployed instance, provided by the URL in the env file.                      | [![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/functional-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/functional-tests.yml)                   |
| scale              | Runs all **scalability** tests on the deployed instance, provided by the URL in the env file.                     | [![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/scalable-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/scalable-tests.yml)                       |
| artillery          | Runs the **scalability** test on the deployed instance, using the [Artillery.io](https://artillery.io) framework. | [![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artillery-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml)           |
| artemis            | Runs the **integration** test with Artemis, either local or deployed depending on the URLs set in the env file.   | [![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml) |
| \*-setup           | These are setup projects and not meant to be run on its own. Dependencies are already set.                        |

## Development

- Single User Playwright Tests are run using a Test Account for Keycloak, to change the Test User, change the environment variables in GitHub Secrets \
  -> Settings -> Secrets and variables -> Actions -> Secrets -> Repository Secrets

- All functional tests (that can also be run on a local instance) have the following file format:
  ```none
  *.functional.spec.ts
  ```
- All scalable tests (that can only be run on a scalable supported instance) have the following file format:
  ```none
  *.scale.spec.ts
  ```
- Tests require to have a specific setup files run before them. These are normally already run by requirements of the **playwright.config.ts**
- The tests safe the URL for each instance in a text file under **/test-data** for debugging and to access them in the tests
- Tests are intended to run on the production environment (https://theia.artemis.cit.tum.de)
  - As tests include testing of all available programming languages: local images for each language can be found here: https://github.com/orgs/ls1intum/packages?repo_name=artemis-theia-blueprints

## Info

This repository contains code from:

- Eclipse Theia: https://github.com/eclipse-theia/theia/tree/master/examples/playwright
- Artemis: https://github.com/ls1intum/Artemis/tree/develop/src/test/playwright
- MCP: https://github.com/modelcontextprotocol/quickstart-resources/tree/main/mcp-client-typescript
