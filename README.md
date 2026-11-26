# Theia Scale Tests

[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/functional-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/functional-tests.yml)
[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/scalable-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/scalable-tests.yml)
[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artillery-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml)
[![Playwright Tests](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml/badge.svg)](https://github.com/ls1intum/theia-scale-tests/actions/workflows/artemis-integration-tests.yml)

---

This repository provides E2E integration tests for EduIDE 3.0 (Theia based IDEs started by the EduIDE control plane). It uses Playwright to simulate real world usage of Online IDE's in large classroom settings.

## Information

- Tests are written using [Playwright](https://playwright.dev)
- Scaled tests run via the Playwright [Artillery](https://artillery.io) Framework or natively only using Playwright
- Make sure, that Sessions per User and max instanecs per App Definition is high enough set on the cluster!

## Setup

- Environment variables
  - Duplicate `playwright.env.template` to `playwright.env` (gitignored) and fill it in:
    - `KEYCLOAK_USER` / `KEYCLOAK_PWD`: a user that may log in to the EduIDE landing page of the target environment (realm `tum`)
    - `LANDINGPAGE_URL`: the environment under test, for example `https://e2e.eduide.student.k8s.aet.cit.tum.de` (see "Testing an environment")
    - The Artemis variables are only used by the manual Artemis suite
- Install dependencies and the Playwright browser
  ```bash
  npm ci
  npx playwright install chromium (not needed in CI, the workflow runs in the Playwright container)
  ```

## Testing an environment

The target is one variable. Set `LANDINGPAGE_URL` in `playwright.env` or on the command line, or in CI pass the `environment` input of the workflow (the landing page hostname, the same string as the EduIDE-deployment environment name):

```bash
LANDINGPAGE_URL=https://e2e.eduide.student.k8s.aet.cit.tum.de npx playwright test --project=functional --project=platform --workers=4
```

Where the functional suite runs:

1. Automatically after every deploy of the e2e environment: EduIDE-deployment (`deploy.yml`, job `e2e-tests`) calls `functional-tests.yml` with `environment` set to the e2e hostname and its `E2E_KEYCLOAK_*` secrets as `KEYCLOAK_USER` / `KEYCLOAK_PWD`.
2. On pull requests and pushes to main here, against the repository variable `LANDINGPAGE_URL` (the e2e environment).
3. By hand: `workflow_dispatch` with the `environment` input, or locally with `LANDINGPAGE_URL`.

GitHub: Actions, "Functional Theia Tests", "Run workflow", type the hostname. Pushes and pull requests use the repository variable `LANDINGPAGE_URL`, which points at the e2e environment.

The suite targets EduIDE 3.0 (Go control plane, new landing page). The landing page signs in at once (no login button) and shows one tile per listed template from `GET /api/v1/templates`, each with a Saved or Temporary badge. A template with variants opens a dialog to pick the project template (Maven, Gradle, ...) or an empty project. In the suite a spec's `app` is the template name (`java-17-standalone`) and its `template` the id of a variant, which a launch sends as `data.TEMPLATE`. Unlisted templates (the Artemis ones) only start from Artemis. What an environment offers is read at run time: a spec whose template or variant the environment does not offer is skipped with the reason. The landing page serves `/config.json` (Keycloak url, realm, client and the API base), which the suite reads instead of the old `config.js`.

## Run Tests

- To run the functional suite on the deployed environment, run:
  ```bash
  npx playwright test --project=functional --project=platform --workers=6
  ```
  This takes about 15 minutes (13 to 15 in CI). The first launch after a deploy can take minutes while images are pulled.
- To run only the pure helper tests (no environment needed): `npm run test:unit`
- Lint: `npm run lint` (ESLint and Prettier; `npx prettier --write .` fixes formatting). CI runs it as the `lint` job before the e2e `test` job, which only starts when lint is clean.
- To run tests locally using a Theia Instance on localhost, change the environment variable to the corresponding port and run the tests using:

  ```bash
  npx playwright test --project=local
  ```

- To run the load tests, run:

  > **_NOTE:_**
  > As load tests use a single account, pay attention that the session per user limit is min the amount of instances you want!

  ```bash
  npx playwright test --project=scale
  ```

  Set the amount of instances in the ENV file or pass it like this (ex. 100 instances):

  ```bash
  NUM_INSTANCES=100 npx playwright test --project=scale
  ```

  To run the tests using the Artillery.io framework, run:

  ```bash
  npx artillery run tests/ide/scalable/artillery/Artillery.ts
  ```

- To run the MCP tests, follow the README in the [**MCP**](mcp/README.md) folder

- To run the benchmark manually for one flavour, run:

  ```bash
  BENCH_TARGET_APP=java-17-standalone BENCH_ARCH=external BENCH_MODE=warm BENCH_SCENARIO=simple-type-error npx playwright test tests/ide/benchmark/LSLatency.ui.benchmark.spec.ts --project=benchmark --headed --workers=1 --reporter=line --no-deps --retries=0
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
  npm run bench:aggregate
  ```

- To run the benchmark with Prometheus-backed resource monitoring against a deployed namespace, run:

  ```bash
  bash scripts/run-benchmark.sh --context <kube-context> --namespace <namespace> --target-app java-17-standalone --arch external --mode warm --scenario import-semantic-error --runs 1 --probes 5 --headed
  ```

  The resource collector reads container CPU and memory from Prometheus cAdvisor metrics and stores them in `test-data/.../raw/resource-raw.csv`.
  It selects session pods by the EduIDE 3.0 labels `eduide.github.io/component=session` and `eduide.github.io/template=<app>`; idle pool pods are left out, and the data bridge runs inside the IDE pod, so there are no separate sidecar pods to watch.

  If the benchmark setup is hard to reproduce from this cleaned test-suite branch, compare against the development branch `feature/benchmark-test3-ui-latency`, which contains the original local benchmark campaign state and debugging history.

| Project                     | Runs                                                                                                                                                                              | Where           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| unit                        | Pure helper specs (`*.unit.spec.ts`), no environment                                                                                                                              | CI on every run |
| functional                  | Specs that work in a launched session of a base template: editor, search, terminal, source control, languages, template files and tasks (`*.functional.spec.ts`, `*.ide.spec.ts`) | CI on every run |
| platform                    | Landing page, login and logout, remaining templates, experience levels, workspace mode, session restart (`*.platform.spec.ts`)                                                    | CI on every run |
| local                       | The functional specs against local containers (`LOCAL_URL_C`, `_JAVA`, `_PYTHON`, `_RUST`, `_JS`)                                                                                 | by hand         |
| scale                       | Scalability tests (`*.scale.spec.ts`)                                                                                                                                             | manual workflow |
| artillery                   | Load test with [Artillery.io](https://artillery.io), refuses to run without a valid `NUM_INSTANCES` and `LANDINGPAGE_URL`, headless unless `HEADED=true`                          | manual workflow |
| artemis                     | Integration with Artemis (needs an Artemis test server and the exercise's Theia image, for example `java-17`)                                                                     | manual workflow |
| benchmark                   | Language server latency, see above                                                                                                                                                | by hand         |
| scale-setup, scale-teardown | Not meant to be run on their own, dependencies are set                                                                                                                            |                 |

`functional` and `platform` share one test user with a per-user session limit (operator `sessionsPerUser`, 10 on e2e). Each spec file launches the session it needs and stops it again, if this run started it. A run holds at most five sessions: three for the functional specs, two for the platform specs. Spec files of one base template (`c-standalone`/make, `java-17-standalone`/maven, `java-25-standalone`/maven, `python-standalone`, `rust-standalone`, `javascript-standalone`/node) take turns, using lock files in `test-data/locks` that global setup clears at the start of a run. The language-independent specs (editor, search, terminal, source control) share the `java-25-standalone`/maven session, because every environment offers Java; the language specs keep their own template and skip where it is not offered. A session that was already running (a leftover or another run) is used but never stopped, and a session is started in a fresh workspace: the workspace of the template is removed first, so the template copy and the template tasks are tested on a new workspace. Sessions are stopped through the EduIDE API, `DELETE /api/v1/sessions/{name}` (logging out of the landing page does not stop them); the API calls are plain `fetch` with an access token that is fetched from the SSO cookies of the stored login, never a browser context, so these calls stay out of the browser trace (a trace can still hold cookies and tokens of other requests, see below). A session or workspace does not name its variant, so the suite tells variants apart by the display title the landing page sets, which is the variant's name.

Two runs against one environment at the same time are not safe: they use the same user, so the same workspaces and sessions per app and template. The `concurrency` group of `functional-tests.yml` queues runs of one repository only. When EduIDE-deployment calls the workflow, the group lives in that repository, so a pull request run here can overlap the run after a deploy. Each run stays within five sessions, so the per-user limit holds, but a template that both runs launch is one shared session. Keep manual runs away from deploys.

### When CI fails

1. The run page: the job summary lists the verdict, counts, a table of failed, flaky and recovered tests with the first line of each error, durations per spec and the metrics. For a run called from EduIDE-deployment it appears on the caller's run page.
2. The `ci-summary` artifact: one `index.html` with the same content and the screenshots of failed tests inline. Download, unzip, open.
3. The `playwright-report` artifact (HTML report with screenshots and error context) and, on failure, `test-results`. There are no traces in CI.

`scripts/ci-summary.mjs` builds the first two from `test-results/results.json` and `test-data/metrics/`.

### Login

The Keycloak login runs in Playwright's global setup (`fixtures/utils/global-login.ts`), not in a test, and stores the session in `.auth/`. A failing test attaches snapshots to the report, and the report is public, so nothing that types credentials is a test. Traces are off in CI because they record every request with its cookies and tokens; set `PW_TRACE=1` to keep traces of failed tests locally. Credentials are only typed on the Keycloak host the landing page config names (or an origin in `LOGIN_HOST_ALLOWLIST`, comma separated). A failed login throws an error that names the step and the page without its query string. The landing page redirects to Keycloak as soon as it loads, and Keycloak forwards to the TUM IdP, so the login adds an empty `kc_idp_hint` to that auth request to get Keycloak's own form (the test account is a local Keycloak user). A second login feeds the logout test, because logging out ends that Keycloak session. The Artemis user logs in there too, only when `--project=artemis` is given. Global setup is skipped for `--project=unit` and `--project=local`.

### Metrics

Specs record durations as Playwright annotations (HTML report) and as one JSON file each in `test-data/metrics/`, which the workflow uploads with the report:

```json
{
  "name": "launch",
  "app": "java-17-standalone",
  "template": "maven",
  "ms": 31842,
  "env": "e2e.eduide.student.k8s.aet.cit.tum.de",
  "timestamp": "2026-11-16T15:04:05.000Z"
}
```

`login` (time to the logged-in landing page), `launch` (tile click to IDE ready) per app and template, `task-run`, `task-build` and `task-test` per template, and `restart` (relaunch of a stopped Saved session). `launch` is written once per spec file that launches the session, the last one wins. `launch` is written once per spec file that launches the session, the last one wins.

### Running the functional suite from another repository

`.github/workflows/functional-tests.yml` is also a reusable workflow, so a deployment pipeline can run the suite against the environment it has just rolled out. `EduIDE/EduIDE-deployment` uses it that way:

```yaml
e2e:
  needs: deploy
  uses: EduIDE/theia-scale-tests/.github/workflows/functional-tests.yml@main
  with:
    environment: e2e.eduide.student.k8s.aet.cit.tum.de
    artemis_url: https://artemis.tum.de
  secrets:
    KEYCLOAK_USER: ${{ secrets.E2E_KEYCLOAK_USER }}
    KEYCLOAK_PWD: ${{ secrets.E2E_KEYCLOAK_PWD }}
```

| Input         | Required |                                                                                                                                                                                              |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment` | yes      | Landing page hostname. Becomes `LANDINGPAGE_URL` as `https://<environment>`                                                                                                                  |
| `artemis_url` | no       | Artemis instance to integrate against, as a full URL. Environments front different Artemis instances, so it belongs to the caller. Empty falls back to the `ARTEMIS_URL` repository variable |

`KEYCLOAK_USER` and `KEYCLOAK_PWD` are required; `ARTEMIS_USER` and `ARTEMIS_PWD`
are optional and only needed by suites that reach Artemis.

The job runs on `ubuntu-24.04`. It used to ask for `[self-hosted, e2e-test]`,
which no registered runner answers to, so every run queued indefinitely. The
environments under test are reachable from the public internet, so a hosted
runner is enough.

`environment` is the landing page hostname; the job turns it into `LANDINGPAGE_URL=https://<environment>`. In EduIDE-deployment the environment name under `environments/` and the landing page hostname are the same string, so the caller passes its environment name through unchanged. Pushes and pull requests on this repository send no input and keep reading `LANDINGPAGE_URL` from the repository variable.

`ARTEMIS_USER` and `ARTEMIS_PWD` are declared as optional secrets. The `functional` project never touches Artemis, so a caller that does not have them can leave them out.

## Development

- Single User Playwright Tests are run using a Test Account for Keycloak, to change the Test User, change the environment variables in GitHub Secrets \
  -> Settings -> Secrets and variables -> Actions -> Secrets -> Repository Secrets

- All functional tests (that can also be run on a local instance) have the following file format:
  ```none
  *.functional.spec.ts
  ```
- Specs that need the landing page and the EduIDE API use `*.platform.spec.ts`
- All scalable tests (that can only be run on a scalable supported instance) have the following file format:
  ```none
  *.scale.spec.ts
  ```
- Tests require to have a specific setup files run before them. These are normally already run by requirements of the **playwright.config.ts**
- The tests safe the URL for each instance in a text file under **/test-data** for debugging and to access them in the tests

## Info

This repository contains code from:

- Eclipse Theia: https://github.com/eclipse-theia/theia/tree/master/examples/playwright
- Artemis: https://github.com/ls1intum/Artemis/tree/develop/src/test/playwright
- MCP: https://github.com/modelcontextprotocol/quickstart-resources/tree/main/mcp-client-typescript
