# AGENTS.md — theia-scale-tests

The end-to-end and load test suite for EduIDE. Playwright throughout; there is
no other test runner. Everything is selected by project in `playwright.config.ts`.

`CLAUDE.md` is a symlink to this file, so every agent reads the same thing.

## Layout

```
tests/setup/                    four Playwright setup projects: keycloak auth, artemis auth,
                                functional IDE URLs, scale IDE URLs
tests/ide/functional/           Editor, Terminal, Search, VSC
tests/ide/programming-language/ one *.ide.spec.ts per language
tests/ide/scalable/             virtual students, scenarios, and the Artillery script
tests/ide/benchmark/            language-server latency benchmark, plus two unit specs
tests/landing/                  the landing page spec - which never runs, see below
pages/ide/theia-pom/            VENDORED from Eclipse Theia. Third-party; eslint ignores it
scripts/env-url.sh              environment name -> URL, read from EduIDE-deployment
docs/running-tests.md           current and accurate. `README.md` is not.
```

## The project name selects the suite, and filenames decide membership

| Filename pattern | Project |
|---|---|
| `*.functional.spec.ts`, `*.ide.spec.ts` | `functional`, `local` |
| `*.scale.spec.ts` | `scale` |
| `*.integration.spec.ts` | `artemis` |
| `*.benchmark.spec.ts`, `*.unit.spec.ts` | `benchmark` |

Helper modules inside `tests/` deliberately omit `.spec` so they are not
collected.

**A spec whose name matches no pattern is silently never run.** That is not
hypothetical: the entire landing-page spec — five live tests — matches nothing
and is dead. Renaming it to `*.functional.spec.ts` revives it, and also revives
a hardcoded identity-provider hostname assertion inside it.

## Running the suites

```bash
npm test                 # functional + per-language, against a live environment
npm run test:artemis     # needs an ADMIN Artemis account; creates and deletes a course
npm run test:scale       # needs NUM_INSTANCES; opens that many real sessions
npm run bench:ui         # LS latency benchmark
npm run bench:aggregate
```

Only the functional suite runs in CI. It is also called by EduIDE-deployment's
deploy workflow after a deploy.

The scale, Artillery and Artemis suites are manual dispatch only. The benchmark
runs nowhere and additionally needs kubectl, a Prometheus endpoint and `jq`.

## Choosing a target environment

`scripts/env-url.sh` reads hostnames out of a checkout of EduIDE-deployment;
`scripts/test-env-url.sh` is its self-test and runs in CI.

```bash
export LANDINGPAGE_URL=$(./scripts/env-url.sh test2)
```

It reads `hosts.configuration` from the environment's **`values.yaml`**, not
`env.yaml` — the manifests split by what reads them, and a hostname is chart
configuration. It refuses to emit a URL containing a `null` segment, because
`yq` returns null for a missing key and that previously produced
`https://null.null`, against which the whole suite ran and passed.

Point `EDUIDE_DEPLOYMENT` at the checkout. Auto-probing only looks one and two
directories up.

## Tests that are inert

Know these before concluding something is covered.

| What | Why |
|---|---|
| The whole landing-page spec | its filename matches no project |
| The whole Scorpio integration spec | wrapped in `test.skip(title, body)`, so its six inner tests are never even registered |
| Git **push** | `test.fixme("Push", …)` with an empty body. Only commit is tested |
| "Launch C instance" | explicitly skipped pending a decision about multiple instances |

The scale suite asserts nothing: passing means the browser survived.

## Traps

**`npm ci` fails.** `package.json` dropped a dependency but `package-lock.json`
was never regenerated and still lists it. Every workflow runs `npm ci`. Run
`npm install` to resync the lockfile before trusting a CI result.

**Global teardown deletes the stored auth state after every run.** Any command
using `--no-deps` — which is how the benchmark is normally invoked — fails on
the second run unless you re-run the auth setup or disable auth.

**Running the pure unit specs requires a Keycloak login**, because they share
the benchmark project and inherit its setup dependency. Use `--no-deps`.

**Hardcoded values that will surprise you:**

- The scale and Artillery suites clone a **personal GitHub repository** as the
  student payload.
- The Artemis suite's pass condition is a **magic score string**. Change the
  solution fixtures or the exercise's test weights and it fails with no
  explanation.
- The Playwright config falls back to the **production** URL if
  `LANDINGPAGE_URL` is unset. Global setup usually throws first.
- The benchmark scripts assume their own URL scheme, independent of
  `env-url.sh`.

**Two env templates that disagree** on instance counts and target URL, both
feeding the same gitignored file. `.env.example` is the current one.

**`LOCAL_URL` is referenced by the `local` project and defined nowhere.** Only
the per-language `LOCAL_URL_*` variables exist, so that project's base URL is
always undefined.

**Two eslint configs.** The `.mjs` one is effective; the `.mts` one is a
leftover scaffold that would produce hundreds of errors if adopted. No CI job
runs lint at all.

**Prettier is a dependency with no config and no script**, so formatting is
inconsistent across the repo.

The `mcp/` directory is an unwired experiment, and its README points at a file
that does not exist. Its two SDK packages are runtime dependencies used by
nothing else.

## Conventions

- Setup projects publish state through files, not fixtures: IDE URLs and auth
  state land in gitignored directories.
- Specs import `test` and `expect` from the fixture module, not from Playwright
  directly — except the benchmark and unit specs.
- Suites run serial, with a `beforeAll` that creates a workspace and an
  `afterAll` that removes it.
- Page objects are `PascalCase.ts`; the vendored Theia ones are kebab-case and
  are not ours to edit.
- Release tags are `vX.Y.Z`.
