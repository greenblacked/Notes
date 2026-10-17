---
title: Zero-downtime deployments on Kubernetes
description: Rolling update settings, probes, graceful shutdown, PodDisruptionBudgets, GCP load balancer draining and expand/contract migrations, with a checklist.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - reliability
  - delivery
created: 2026-10-16
modified: 2026-10-17
draft: false
---

A rolling update that drops requests is almost never a Kubernetes bug. It is one of four gaps: new Pods receive traffic before they are ready, old Pods stop before traffic stops reaching them, too many Pods go away at once, or a schema change breaks the old version. This note closes each gap in order. Field semantics are in the Kubernetes documentation (Deployments, Pod lifecycle, Disruptions); the GKE specifics are in the Google Cloud documentation for load balancing and container-native load balancing.

## The rolling update strategy

```yaml title="deployment.yaml (excerpt)"
spec:
  replicas: 3
  minReadySeconds: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 0
```

- `maxUnavailable: 0` means capacity never drops below the desired replica count during the rollout. The cost is `maxSurge`: you need room for extra Pods, so check quota and node capacity (on Standard clusters, spare node capacity or autoscaler headroom).
- `maxSurge` is how many extra Pods may exist. Larger values make rollouts faster and use more resources. With 3 replicas, 25 percent rounds up to 1.
- `minReadySeconds` makes a new Pod count as available only after it has been ready for that long. It catches Pods that become ready and crash seconds later.
- Set `progressDeadlineSeconds` so a stuck rollout is reported as failed, and use `kubectl rollout status` in CI.
- Defaults for `maxSurge` and `maxUnavailable` are both 25 percent; with a single replica or small counts, set them explicitly rather than rely on rounding.

## Probes: readiness, liveness, startup

| Probe     | Question                              | On failure                                    | Do not use for         |
| --------- | ------------------------------------- | --------------------------------------------- | ---------------------- |
| Startup   | Has the app finished starting?        | Container is restarted; other probes wait     | Anything after startup |
| Readiness | Can it take traffic right now?        | Removed from Service endpoints; not restarted | Hiding crashes         |
| Liveness  | Is the process stuck beyond recovery? | Container is restarted                        | Dependency checks      |

```yaml title="deployment.yaml (excerpt)"
containers:
  - name: app
    ports:
      - name: http
        containerPort: 8080
    startupProbe:
      httpGet: { path: /healthz, port: http }
      periodSeconds: 5
      failureThreshold: 30 # up to 150 s to start
    readinessProbe:
      httpGet: { path: /ready, port: http }
      periodSeconds: 5
      timeoutSeconds: 2
      failureThreshold: 2
    livenessProbe:
      httpGet: { path: /healthz, port: http }
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3
```

Rules that prevent most incidents:

- **Readiness reflects ability to serve**, including that caches are warm and the Pod is not draining. It may check a hard dependency the service cannot work without, but be careful: if every Pod's readiness depends on the same database, a database blip removes all Pods at once.
- **Liveness is cheap and local.** It checks only that the process responds. Never check a database or another service in it; a downstream outage then restarts every Pod and makes things worse.
- Use a **startup probe** for slow starters (the JVM, large caches) instead of a long `initialDelaySeconds` on liveness.
- A Pod with no readiness probe is ready as soon as the container starts. That is the usual cause of errors at the beginning of a rollout.

## Graceful shutdown

When a Pod is deleted, two things happen in parallel: the kubelet sends SIGTERM (after any `preStop` hook), and the control plane removes the Pod from Service endpoints. Endpoint removal then propagates to kube-proxy, ingress controllers and load balancers, which takes seconds. During that window the Pod still receives new connections. If the process exits immediately on SIGTERM, those requests fail.

The fix is to wait before shutting down, then drain:

```yaml title="deployment.yaml (excerpt)"
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "15"]
```

Sequence: the Pod is marked terminating, `preStop` sleeps 15 seconds while endpoints propagate, SIGTERM then arrives, the application stops accepting connections, finishes in-flight requests, and exits. If the process is still running after `terminationGracePeriodSeconds` (which counts from the start of the `preStop` hook), it receives SIGKILL.

- Size it as `preStop` sleep + longest request or drain time + margin. Do not leave the default if your requests can take longer than that.
- The `sleep` command must exist in the image. Distroless images have none; recent Kubernetes versions support a native `sleep` lifecycle handler (`preStop.sleep.seconds`), but check that your cluster version supports it before using it. Otherwise implement the delay in the application.
- The application must handle SIGTERM: stop listening, finish in-flight work, close connections, then exit. Make sure the process is PID 1 or that the entrypoint forwards signals (`exec` in shell wrappers, or an init such as tini), or SIGTERM never reaches it.
- Fail readiness once shutdown starts, so any health-check-based load balancer also stops sending traffic.

## PodDisruptionBudgets

Rolling updates are controlled by the Deployment; voluntary disruptions (node drains, cluster upgrades, autoscaler scale-down) are controlled by PDBs.

```yaml title="pdb.yaml"
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-service
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: my-service
```

- Create one for every multi-replica production service. Without it a node pool upgrade can evict all replicas on a node at once, or all replicas of a small service.
- Use `maxUnavailable` or `minAvailable`, not both. For a single-replica workload a PDB that allows no disruption blocks drains and cluster upgrades indefinitely; either run two replicas or accept disruption.
- PDBs do not protect against involuntary failures (node crash) or against your own Deployment rollout. Spread replicas with `topologySpreadConstraints` across zones to survive a zone failure.
- Check them before an upgrade: `kubectl get pdb -A` and look for `ALLOWED DISRUPTIONS` of 0. See [[gke-cluster-upgrade]].

## Draining behind GCP load balancers

With container-native load balancing on GKE (NEGs), the load balancer sends traffic directly to Pod IPs, so it has its own view of backend health, separate from Service endpoints. Two settings matter:

- **Connection draining timeout** on the backend service, so in-flight requests on a removed backend can finish. Configure it with a `BackendConfig` attached to the Service (or the equivalent policy for the Gateway API; check the GKE documentation for the resource that matches your setup):

```yaml title="backendconfig.yaml"
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: my-service
spec:
  connectionDraining:
    drainingTimeoutSec: 30
  healthCheck:
    requestPath: /ready
    port: 8080
    type: HTTP
```

```yaml title="service.yaml (excerpt)"
metadata:
  annotations:
    cloud.google.com/neg: '{"ingress": true}'
    cloud.google.com/backend-config: '{"default": "my-service"}'
```

- **Pod readiness gates.** With NEGs GKE can hold a new Pod "not ready" until the load balancer reports its backend healthy, so a rollout does not remove old Pods before the new ones receive traffic. This is automatic for Services in a cluster that uses container-native load balancing with the readiness gate injected; verify in the GKE documentation that it applies to your cluster version.
- Match the timers: `preStop` sleep and `terminationGracePeriodSeconds` must be longer than the load balancer's propagation and draining time, otherwise the Pod is killed while the load balancer still sends to it.
- Make the load balancer health check path match the readiness probe, with realistic thresholds.

## Database migrations: expand and contract

Old and new application versions run side by side during a rollout, so the schema must work for both. Never ship a migration that breaks the running version.

1. **Expand.** Add the new column, table or index in a backwards-compatible way (nullable, with a default, created without long locks). Deploy.
2. **Migrate.** Release the application that writes to both old and new structures and reads from the new one. Backfill existing rows in batches, outside the deploy.
3. **Contract.** Once no running version uses the old structure, remove it in a later release.

Rules: no `NOT NULL` column without a default added in one step on a large table; no rename (add, copy, switch, drop instead); build indexes concurrently where your database supports it; run migrations as a separate job before the rollout, not in every Pod's startup, so N replicas do not race. Rolling back the application must remain safe at every step, which is why contract comes last.

## Canary and blue-green

A plain rolling update shifts traffic by Pod count and cannot hold at 5 percent or pause for analysis. When you need controlled exposure:

| Option             | How                                                                                                                            | Notes                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argo Rollouts      | A `Rollout` resource replaces the Deployment; steps shift traffic by weight, with analysis against metrics and automatic abort | Works with GitOps, see [[0001-gitops-with-argocd]]; needs a traffic-splitting integration (ingress, service mesh or Gateway API) for exact weights |
| Spinnaker          | Pipeline stages for canary analysis, blue/green and manual judgement                                                           | Heavier to run; fits multi-cloud and existing Spinnaker estates                                                                                    |
| Blue-green by hand | Deploy a second Deployment and switch the Service selector or load balancer                                                    | Simple and fast to roll back; costs double capacity during the switch                                                                              |
| Flagger            | Progressive delivery operator that works with Flux and common meshes                                                           | Comparable to Argo Rollouts; see [[argocd-vs-flux]] for the GitOps context                                                                         |

Start with a well-configured rolling update. Add canary analysis when the cost of a bad release justifies the extra component, and base the analysis on the same SLIs you alert on ([[slo-burn-rate-alerting]]). Details for Argo Rollouts: [[patterns/progressive-delivery-argo-rollouts]].

## Verification checklist

Before declaring a service zero-downtime, test it; do not assume.

- [ ] At least 2 replicas, spread across zones.
- [ ] `maxUnavailable: 0` and sufficient surge capacity.
- [ ] Readiness, liveness and (if needed) startup probes exist and check different things.
- [ ] Liveness does not call dependencies.
- [ ] `preStop` delay and `terminationGracePeriodSeconds` cover endpoint propagation plus the longest request.
- [ ] Application handles SIGTERM and receives it (PID 1 or init).
- [ ] PDB exists and allows at least one disruption.
- [ ] Load balancer draining timeout and health check match the Pod settings.
- [ ] Migrations are backwards compatible and run as a separate step.
- [ ] A rollback was rehearsed ([[helm-release-rollback]]).

Test under load. This runs requests continuously during a rollout and counts failures:

```bash
URL="https://staging.example.com/api/ping"
NAMESPACE="my-service"
DEPLOYMENT="my-service"
FAILS=0

( while true; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${URL}")
    [ "${code}" = "200" ] || echo "$(date +%T) HTTP ${code}"
    sleep 0.1
  done ) &
LOAD_PID=$!

kubectl rollout restart deployment/"${DEPLOYMENT}" --namespace "${NAMESPACE}"
kubectl rollout status deployment/"${DEPLOYMENT}" --namespace "${NAMESPACE}" --timeout=300s

kill "${LOAD_PID}"
```

Any line printed is a dropped request. Repeat during a node drain (`kubectl drain`) in staging to prove the PDB and shutdown settings. For a proper load profile use a tool such as k6 or vegeta in CI.

> [!tip] Make the pattern the default
> Put these settings in the shared chart ([[helm-chart-conventions]]) so teams get graceful shutdown, probes and a PDB without having to remember them.
