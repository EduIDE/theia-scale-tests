# Running the tests

```bash
cp .env.example playwright.env      # fill in KEYCLOAK_USER / KEYCLOAK_PWD
npm ci
npx playwright install --with-deps chromium

export LANDINGPAGE_URL=$(./scripts/env-url.sh test2)
npm test
```

`scripts/env-url.sh` reads the environment manifests in EduIDE-deployment, so
the URL is never hardcoded here. Point `EDUIDE_DEPLOYMENT` at that checkout if
it is not next door.

```
./scripts/env-url.sh test2            https://test2.theia-test.artemis.cit.tum.de
./scripts/env-url.sh staging service  https://service.theia-staging.artemis.cit.tum.de
```

## Suites

| Command | What |
|---|---|
| `npm test` | functional and per-language tests |
| `npm run test:artemis` | Artemis integration, needs `ARTEMIS_*` |
| `npm run test:scale` | virtual students, needs `NUM_INSTANCES` |
| `npm run bench:ui` | language-server latency benchmark |

Add `HEADED=true` to watch a run.

## CI

| Workflow | Trigger |
|---|---|
| Functional tests | push, pull request, **and automatically after every deploy to `e2e-test`** |
| Artemis integration | manual only |
| Artillery load test | manual only |
| Scalable tests | manual only |

**Only the functional tests run in CI.** They are invoked by
`deploy-e2e.yml` in EduIDE-deployment as soon as a deploy to `e2e-test`
finishes, so a failure means the code is broken rather than that the deploy
was half-finished — the deploy job uses `--wait --atomic`, so it only goes
green on a healthy rollout.

`e2e-test` exists so the suite has somewhere to run that nobody is using.
Running against a shared test environment means a red build might only mean a
colleague was mid-experiment, which is how a suite stops being trusted.

The Artemis suite creates a course and an exercise on a live Artemis, submits
code and waits for a result. Too slow and too stateful for every pull request.

Artillery used to run on every push and pass in about two minutes having
generated no load at all: the workflow never set `NUM_INSTANCES`, so it ran
with `arrivalRate: NaN`. It also asked for a headed browser on a runner with no
display. It is manual now, and `Artillery.ts` refuses to start without a valid
`NUM_INSTANCES`.

The three real suites also used to sit on `runs-on: [self-hosted, e2e-test]`, a
label no registered runner carries, so they queued for 24 hours and were
cancelled. They had not executed since roughly March 2026.

## Known gaps

Worth knowing before trusting a green run:

- Git **push** is `test.fixme` with an empty body, so pushing is never tested.
- The whole Scorpio submission suite is `test.skip`.
- The scale suite asserts nothing quantitative: pass means the browser
  survived. The benchmark suite does measure properly but is single-session and
  writes only into gitignored `test-data/`.
- One Keycloak account is shared by all virtual users, so `sessionsPerUser` on
  the target environment caps the achievable load. `test1` is configured for
  1000 for exactly this reason.
