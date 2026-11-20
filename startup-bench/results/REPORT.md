# Startup comparison, 2026-11-20

Same IDE image for every variant: `ghcr.io/eduide/eduide/java-17-standalone@sha256:efe68ad83f6133bcc5b274f8f4da3f5fd3dcfde4c063423f7c536bca0fbf2515`, pre-pulled on every node a session could land on.
Sessions are created directly as CRs, the service API is not part of the measurement.
Times are seconds after the CR was created.

| Variant                                             | Where                                              | Runs (cold / warm) |
| --------------------------------------------------- | -------------------------------------------------- | ------------------ |
| Theia Cloud upstream 1.2.0                          | stud, `eduide-upstream` (temporary), nginx Ingress | 20 / 20            |
| EduIDE Cloud 3.0.4 (Helm 3.0.0-rc.8, Java operator) | stud, `eduide-test2`, Envoy gateway                | 30 / 30            |
| EduIDE Go control plane 0.1.0 (sha-c57925d)         | stud, `eduide-test3`, Envoy gateway                | 20 / 20            |

## Summary (median, p90 in brackets)

| Milestone                       | Upstream cold | Cloud 3.0.4 cold | Go cold       | Upstream warm   | Cloud 3.0.4 warm | Go warm       |
| ------------------------------- | ------------- | ---------------- | ------------- | --------------- | ---------------- | ------------- |
| Session has a URL               | 0.4 (0.5) \*  | 2.9 (3.4)        | 2.1 (2.8)     | 8.0 (8.1)       | 1.5 (1.6)        | 0.2 (0.3)     |
| Theia answers HTTP              | 3.2 (3.5)     | 2.5 (2.8)        | 2.3 (2.7)     | 8.2 (8.4)       | 1.8 (1.9)        | 0.5 (0.6)     |
| Public route answers            | 4.2 (4.2)     | 3.0 (3.5)        | -             | 8.1 (8.2)       | 1.7 (1.8)        | -             |
| **Explorer rendered**           | **6.2 (6.8)** | **4.9 (5.5)**    | **4.3 (5.0)** | **10.5 (10.9)** | **3.6 (3.7)**    | **2.5 (2.6)** |
| Cleanup (delete until pod gone) | 1.7           | 1.6              | 1.6           | 1.8             | 1.6              | 1.6           |
| Pool refilled after delete      | -             | -                | -             | 4.6 (34.6) \*\* | 4.4 (4.4)        | 2.0 (2.6)     |
| Kubernetes objects per session  | 7             | 8                | 4             | 0               | 1                | 4             |
| Control plane memory            | 491 Mi        | 756 Mi           | 166 Mi        | 497 Mi          | 751 Mi           | 169 Mi        |
| Control plane CPU               | 11m           | 5m               | 13m           | 6m              | 5m               | 15m           |

\* Upstream in lazy mode marks the session handled right away and publishes no URL; the harness uses `/instances/<session uid>/` from then on.
\*\* One refill took 300 s (the harness timeout), the operator logged "Error while removing ingress rule: The rule's HTTP block is null" on release.

- Cold: Go is about 0.6 s faster than EduIDE Cloud, and EduIDE Cloud is about 1.3 s faster than upstream.
  Upstream pulls its oauth2-proxy with `imagePullPolicy: Always` on every start (about 0.8 s against the registry) and its nginx route answers about 1 s after the pod.
- Warm: Go is about 1.1 s faster than EduIDE Cloud. Upstream's warm start is slower than its cold start: it claims the idle pod in 0.3 s, then adds an annotation so oauth2-proxy reloads the user list, and publishes the URL only once the instance answers again, about 8 s later.
- The Go control plane uses about a third of upstream's and less than a quarter of EduIDE Cloud's memory.

## Caveats

- The variants run in different namespaces behind different gateways.
  EduIDE Cloud and Go pin sessions to the 9 nodes of the `eduide` pool; upstream cannot, its pods landed on pve-worker7, ito-worker5 and ito-worker10.
  Differences below 0.5 s are a hint, not proof.
- Upstream setup on stud: AppDefinition v1beta10 was set to served for the measurement (the existing conversion webhook converts it, storage stayed v1beta11), Keycloak on with the test realm so every pod has the same oauth2-proxy shape as EduIDE Cloud (the image binds Theia to 127.0.0.1), a namespaced Role for ingresses, and a `hostAliases` entry so the operator's availability check reaches nginx.
  Files in `setup/upstream-*`. Everything was removed afterwards and v1beta10 is unserved again.
- Changing the served versions of the CRD made every EduIDE operator on stud (test1, test2, staging, e2e) restart once per change: the AppDefinition watch does not reconnect and the operator restarts after 10 tries.
- test3 asks for a login at the gateway on every path, so an anonymous request cannot tell a session route apart.
  For Go the page load waits for `routeAccepted` (the gateway accepted the session HTTPRoute) instead of `routed`.
  `routeAccepted` is polled through kubectl and lags by about 0.2 s; on EduIDE Cloud it came after `routed` (warm 1.9 s against 1.7 s).
- The Explorer is measured through a port-forward, so it includes the Theia start but not the gateway hop.
- Discarded runs: the first test2 series (two harness bugs: CR watch race, port-forward dying on a refused connect) and 20 test2 runs where `routeAccepted` required every gateway parent to accept the route.
  The upstream cold runs were first flagged as image pulls because of the oauth2-proxy pull; they were re-checked from the pod events, none pulled the IDE image.

## Full tables

Generated with `node report.mjs results/*.jsonl`.

## eduide-cloud / cold

30 runs, 30 counted, 0 failed, 0 left out because the node pulled the image.
From 2026-11-20T03:02:05.800Z to 2026-11-20T06:04:17.352Z.

| Milestone (s after CR created)     | n   | median | p90 | min | max | mean | sd  |
| ---------------------------------- | --- | ------ | --- | --- | --- | ---- | --- |
| Control plane publishes the URL    | 30  | 2.9    | 3.4 | 2.4 | 5.0 | 3.0  | 0.5 |
| Pod scheduled                      | 30  | 0.4    | 0.4 | 0.3 | 0.8 | 0.4  | 0.1 |
| IDE container running              | 30  | 2.1    | 2.5 | 1.7 | 3.2 | 2.1  | 0.3 |
| Pod ready                          | 30  | 2.1    | 2.5 | 1.7 | 3.2 | 2.1  | 0.3 |
| Theia answers HTTP                 | 30  | 2.5    | 2.8 | 2.1 | 3.5 | 2.5  | 0.3 |
| Workbench shell visible            | 30  | 4.8    | 5.5 | 3.7 | 7.1 | 4.8  | 0.7 |
| Explorer tree rendered             | 30  | 4.9    | 5.5 | 4.1 | 7.1 | 5.0  | 0.5 |
| Public route answers               | 30  | 3.0    | 3.5 | 2.5 | 5.0 | 3.1  | 0.5 |
| Gateway accepted the session route | 10  | 3.2    | 3.8 | 2.7 | 4.2 | 3.3  | 0.4 |
| Control plane reports ready        | 30  | 2.9    | 3.4 | 2.4 | 5.0 | 3.0  | 0.5 |
| Cleanup (delete until pod gone)    | 30  | 1.6    | 2.3 | 1.5 | 2.3 | 1.8  | 0.3 |

Objects created per session (median): 8. Control plane after a start (median): 5m CPU, 756 Mi memory.

## eduide-cloud / warm

30 runs, 30 counted, 0 failed, 0 left out because the node pulled the image.
From 2026-11-20T03:05:20.690Z to 2026-11-20T06:07:34.193Z.

| Milestone (s after CR created)                     | n   | median | p90 | min | max | mean | sd  |
| -------------------------------------------------- | --- | ------ | --- | --- | --- | ---- | --- |
| Control plane publishes the URL                    | 30  | 1.5    | 1.6 | 1.4 | 1.8 | 1.5  | 0.1 |
| Theia answers HTTP                                 | 30  | 1.8    | 1.9 | 1.7 | 2.1 | 1.8  | 0.1 |
| Workbench shell visible                            | 30  | 3.5    | 3.6 | 2.9 | 3.9 | 3.4  | 0.3 |
| Explorer tree rendered                             | 30  | 3.6    | 3.7 | 3.3 | 3.9 | 3.6  | 0.1 |
| Public route answers                               | 30  | 1.7    | 1.8 | 1.7 | 2.0 | 1.7  | 0.1 |
| Gateway accepted the session route                 | 10  | 1.9    | 2.0 | 1.8 | 2.0 | 1.9  | 0.0 |
| Control plane reports ready                        | 30  | 1.5    | 1.6 | 1.4 | 1.8 | 1.5  | 0.1 |
| Cleanup (delete until pod gone)                    | 30  | 1.6    | 2.3 | 1.6 | 2.3 | 1.8  | 0.3 |
| Pool refilled (delete until a ready idle instance) | 30  | 4.4    | 4.4 | 2.0 | 5.0 | 3.6  | 1.1 |

Objects created per session (median): 1. Control plane after a start (median): 5m CPU, 751 Mi memory.

## go / cold

20 runs, 20 counted, 0 failed, 0 left out because the node pulled the image.
From 2026-11-20T03:37:49.415Z to 2026-11-20T03:58:58.758Z.

| Milestone (s after CR created)     | n   | median | p90 | min | max | mean | sd  |
| ---------------------------------- | --- | ------ | --- | --- | --- | ---- | --- |
| Control plane publishes the URL    | 20  | 2.1    | 2.8 | 1.8 | 2.9 | 2.3  | 0.4 |
| Pod scheduled                      | 20  | 0.3    | 0.3 | 0.2 | 0.3 | 0.3  | 0.0 |
| IDE container running              | 20  | 2.0    | 2.4 | 1.8 | 2.6 | 2.0  | 0.2 |
| Pod ready                          | 20  | 2.1    | 2.8 | 1.8 | 2.9 | 2.2  | 0.4 |
| Theia answers HTTP                 | 20  | 2.3    | 2.7 | 2.1 | 2.9 | 2.3  | 0.2 |
| Workbench shell visible            | 20  | 4.1    | 5.0 | 3.4 | 5.2 | 4.2  | 0.5 |
| Explorer tree rendered             | 20  | 4.3    | 5.0 | 3.9 | 5.2 | 4.4  | 0.4 |
| Gateway accepted the session route | 20  | 2.4    | 3.2 | 2.1 | 3.3 | 2.6  | 0.4 |
| Control plane reports ready        | 20  | 2.1    | 2.8 | 1.8 | 2.9 | 2.3  | 0.4 |
| Cleanup (delete until pod gone)    | 20  | 1.6    | 1.6 | 1.0 | 3.2 | 1.7  | 0.4 |

Objects created per session (median): 4. Control plane after a start (median): 13m CPU, 165.5 Mi memory.
Start strategy reported by the control plane: cold.

## go / warm

20 runs, 20 counted, 0 failed, 0 left out because the node pulled the image.
From 2026-11-20T03:41:02.148Z to 2026-11-20T04:02:04.671Z.

| Milestone (s after CR created)                     | n   | median | p90 | min | max | mean | sd  |
| -------------------------------------------------- | --- | ------ | --- | --- | --- | ---- | --- |
| Control plane publishes the URL                    | 20  | 0.2    | 0.3 | 0.2 | 0.5 | 0.3  | 0.1 |
| Pod scheduled                                      | 20  | 0.3    | 0.3 | 0.2 | 0.5 | 0.3  | 0.1 |
| IDE container running                              | 20  | 0.3    | 0.3 | 0.2 | 0.5 | 0.3  | 0.1 |
| Pod ready                                          | 20  | 0.3    | 0.3 | 0.2 | 0.5 | 0.3  | 0.1 |
| Theia answers HTTP                                 | 20  | 0.5    | 0.6 | 0.5 | 0.8 | 0.5  | 0.1 |
| Workbench shell visible                            | 20  | 2.4    | 2.6 | 1.8 | 2.8 | 2.3  | 0.3 |
| Explorer tree rendered                             | 20  | 2.5    | 2.6 | 2.3 | 2.8 | 2.5  | 0.1 |
| Gateway accepted the session route                 | 20  | 0.6    | 0.7 | 0.6 | 0.9 | 0.7  | 0.1 |
| Control plane reports ready                        | 20  | 0.2    | 0.3 | 0.2 | 0.5 | 0.3  | 0.1 |
| Cleanup (delete until pod gone)                    | 20  | 1.6    | 2.3 | 0.9 | 2.3 | 1.8  | 0.4 |
| Pool refilled (delete until a ready idle instance) | 20  | 2.0    | 2.6 | 1.3 | 2.7 | 2.1  | 0.4 |

Objects created per session (median): 4. Control plane after a start (median): 14.5m CPU, 169 Mi memory.
Start strategy reported by the control plane: warm-ready.

## upstream / cold

20 runs, 20 counted, 0 failed, 0 left out because the node pulled the image.
From 2026-11-20T11:30:13.080Z to 2026-11-20T11:42:47.333Z.

| Milestone (s after CR created)  | n   | median | p90 | min | max | mean | sd  |
| ------------------------------- | --- | ------ | --- | --- | --- | ---- | --- |
| Control plane publishes the URL | 20  | 0.4    | 0.5 | 0.3 | 0.5 | 0.4  | 0.1 |
| Pod scheduled                   | 20  | 0.3    | 0.4 | 0.3 | 0.5 | 0.4  | 0.1 |
| IDE container running           | 20  | 2.9    | 3.2 | 2.2 | 3.2 | 2.9  | 0.3 |
| Pod ready                       | 20  | 2.9    | 3.2 | 2.2 | 3.2 | 2.9  | 0.3 |
| Theia answers HTTP              | 20  | 3.2    | 3.5 | 2.9 | 5.2 | 3.3  | 0.5 |
| Workbench shell visible         | 20  | 6.1    | 6.6 | 6.0 | 7.2 | 6.2  | 0.3 |
| Explorer tree rendered          | 20  | 6.2    | 6.8 | 6.0 | 7.3 | 6.4  | 0.3 |
| Public route answers            | 20  | 4.2    | 4.2 | 4.1 | 4.3 | 4.2  | 0.1 |
| Control plane reports ready     | 20  | 0.4    | 0.5 | 0.3 | 0.5 | 0.4  | 0.1 |
| Cleanup (delete until pod gone) | 20  | 1.7    | 2.3 | 1.0 | 2.3 | 1.8  | 0.3 |

Objects created per session (median): 7. Control plane after a start (median): 11m CPU, 490.5 Mi memory.

## upstream / warm

20 runs, 20 counted, 0 failed, 0 left out because the node pulled the image.
From 2026-11-20T11:52:52.561Z to 2026-11-20T12:17:32.808Z.

| Milestone (s after CR created)                     | n   | median | p90  | min | max   | mean | sd   |
| -------------------------------------------------- | --- | ------ | ---- | --- | ----- | ---- | ---- |
| Control plane publishes the URL                    | 20  | 8.0    | 8.1  | 5.4 | 8.1   | 7.8  | 0.6  |
| Theia answers HTTP                                 | 20  | 8.2    | 8.4  | 5.8 | 8.5   | 8.1  | 0.6  |
| Workbench shell visible                            | 20  | 10.2   | 10.5 | 7.8 | 11.0  | 10.1 | 0.6  |
| Explorer tree rendered                             | 20  | 10.5   | 10.9 | 8.0 | 11.5  | 10.4 | 0.7  |
| Public route answers                               | 20  | 8.1    | 8.2  | 5.6 | 8.3   | 8.0  | 0.6  |
| Control plane reports ready                        | 20  | 8.0    | 8.1  | 5.4 | 8.1   | 7.8  | 0.6  |
| Cleanup (delete until pod gone)                    | 18  | 1.8    | 2.3  | 1.2 | 2.5   | 1.9  | 0.3  |
| Pool refilled (delete until a ready idle instance) | 20  | 4.6    | 34.6 | 2.7 | 300.6 | 34.1 | 91.1 |

Objects created per session (median): 0. Control plane after a start (median): 6m CPU, 497 Mi memory.
