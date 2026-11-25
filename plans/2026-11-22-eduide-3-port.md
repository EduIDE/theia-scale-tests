# Port of the suite to EduIDE 3.0

## Goal

Run the Playwright suite against EduIDE 3.0 (Go control plane, new landing page) instead of the Java stack (Theia Cloud service, old landing page).
The first target is https://e2e.eduide.student.k8s.aet.cit.tum.de.

## What changed

- `fixtures/utils/service.ts`: `CloudConfig` from `window.theiaCloudConfig` is gone. The config is `GET /config.json` (`parseConfig`, `fetchConfig`), the catalog is `GET /api/v1/templates`. `CloudService` talks to `/api/v1` (sessions, workspaces, templates) with an access token from the SSO cookies (PKCE, plain fetch). `workspaceName` is removed, the server derives workspace names.
- Matching: a session or workspace belongs to a spec when its `template` is the spec's `app` and its `display.title` is the variant name (`matchByVariant`). Without variant metadata the template alone decides.
- `fixtures/utils/catalog.ts`: spec shape kept. `app` is a 3.0 template name, `template` a variant id (sent as `data.TEMPLATE`). `unavailableReason` skips a spec when the environment does not offer the template; a variant the offered template does not list fails as a catalog bug.
- `pages/landing/LandingPage.ts`: no login button, the page signs in at once. `login` opens the page itself and keeps the empty `kc_idp_hint` route and the credential origin allowlist. Logged in is the avatar, logout is the Sign out link in its menu. Tiles are found by `data-testid`, with an index fallback over the listed templates until the landing page with test ids is deployed. The pick dialog radios are found by `data-testid` or `input[name=variant][value=id]`.
- Dropped without replacement: the ephemeral flag from the config (the badge and the status bar follow `defaultPersistence`), `buildSystems` from the config, `serviceAuthToken`.
- Skips: only a template the environment does not offer (or that has no tile) skips. A variant the template does not list fails, it is a catalog bug. Without variant metadata siblings share launch key, session and workspace, so only the first catalog spec of a template is available.
- Failed sessions are listed but ignored by a launch, so they do not count as running. Stopping still deletes them, a 404 on a delete counts as done.
- The workspace spec picks its template from what the environment offers (`chooseStateTemplate`) and shares the lock of the remaining templates.
- `scripts/monitor-benchmark-resources.sh` selects pods by the `eduide.github.io/` labels. There are no separate sidecar pods in 3.0, so that part is gone.
- Platform specs: landing (tile per listed template with badge, pick dialog, logout), workspace (skips the restart test when the template has no saved workspace by default).

## Open points (not verifiable without a test login)

- The whole authenticated path: token fetch (access token, redirect URI `/`), API calls, tiles, pick dialog, launch redirect, IDE wait.
- `waitForIdeUrl` waits for the session origin, then 60 s for `#/home/project` and goes on without it. Whether 3.0 session URLs get that hash is unknown.
- Whether each variant gets its own workspace and a `display.title` equal to the variant name (read from the control plane source, not observed).
- Status bar items `eduide-experience-level` and `eduide-workspace-mode`, template tasks and files of the 3.0 images.
- Catalog entries other than `java-17-standalone` and `java-25-standalone` (c, go, python, rust, javascript) are skipped on e2e, which offers only the Java templates. The base specs for those languages skip with it.
- Remove the index fallback in `LandingPage.tile` once the landing page with `data-testid` is deployed.
- The Artemis specs go through Artemis and were only checked for compilation. Their login uses `LandingPage.login`.
