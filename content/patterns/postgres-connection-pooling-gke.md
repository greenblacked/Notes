---
title: Postgres connection pooling for GKE workloads
description: Size a connection budget for autoscaled pods against Cloud SQL, and run PgBouncer as a sidecar or shared Deployment behind the Auth Proxy.
type: pattern
tags:
  - patterns
  - gke
  - kubernetes
  - gcp
  - reliability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

A Postgres server has a fixed number of connections. A Kubernetes workload does not: the HorizontalPodAutoscaler adds pods under load, every pod opens its own pool, and the database runs out of connections at the moment you most need it. The service then fails with `too many clients` or `remaining connection slots are reserved`, new pods fail their readiness checks, and the autoscaler adds more pods. This note gives a budget formula to prevent it and a PgBouncer layout on GKE with Cloud SQL.

> [!info] Scope and what is not verified
> The configuration is written from the PgBouncer and Cloud SQL Auth Proxy interfaces as known; nothing here was run, and the note is not marked `verified`. Not verified, check before relying on this: the PgBouncer version that added support for protocol-level prepared statements in transaction mode, the `max_connections` value per Cloud SQL tier, whether Cloud SQL managed connection pooling is generally available for your edition, and the Auth Proxy flags of your version.

## The budget formula

Connections are a budget you spend on purpose. Write the budget down per database, not per service.

```text
sum over clients (max replicas x pool size per replica) + reserve  <=  max_connections
```

- **Max replicas** is the HPA `maxReplicas`, not today's replica count. Rolling updates add surge pods on top of that ([[zero-downtime-deployments-kubernetes]]), so add `maxSurge`. See [[kubernetes-autoscaling]].
- **Pool size per replica** is the largest number of server connections one pod can hold open. With PgBouncer it is `default_pool_size + reserve_pool_size` for each database and user pair, not the application pool size.
- **Reserve** covers the connections you need when the application is saturated: superuser and maintenance access, migration jobs ([[postgres-expand-contract-migrations]]), monitoring agents, read replicas' replication, and one-off `psql` sessions. Cloud SQL itself keeps some for its own use.
- **`max_connections`** is a database flag with a per-tier default. Read the real value, do not assume.

```bash
# CHANGE: connect through the Auth Proxy or a psql session to the instance.
psql "host=127.0.0.1 port=5432 user=postgres dbname=postgres" \
  -c "SHOW max_connections;" \
  -c "SELECT count(*) AS in_use FROM pg_stat_activity;"
```

Memory is the other half of the limit. Each backend process uses memory, so raising `max_connections` to fit a bad design costs RAM and often makes the database slower, not faster. Pooling is the correct fix; a bigger flag is the emergency one.

### Worked budget for 30 pods

Assume `max_connections` is **200** on this instance (an assumption for the example; read yours), a reserve of **20**, and an HPA that can reach **30** pods.

| Layout                                                                | Per-pod ceiling | Pods or poolers | Server connections | Plus reserve | Fits in 200? |
| --------------------------------------------------------------------- | --------------- | --------------- | ------------------ | ------------ | ------------ |
| App pool of 20, no pooler                                             | 20              | 30              | 600                | 620          | No           |
| PgBouncer sidecar, `default_pool_size 20`, reserve 5                  | 25              | 30              | 750                | 770          | No           |
| PgBouncer sidecar, pool 4, reserve 1                                  | 5               | 30              | 150                | 170          | Yes          |
| Shared PgBouncer Deployment, 3 replicas + 1 surge, pool 20, reserve 5 | 25 per pooler   | 4               | 100                | 120          | Yes          |

The sidecar with the sample pool settings does not fit: a sidecar multiplies the pool by the number of pods, which is exactly what you are trying to avoid. The shared pooler fits because its size depends on the number of poolers, not the number of application pods. This is the main reason to prefer a shared pooler for autoscaled services.

> [!warning] Include the autoscaler ceiling
> Budgets calculated from today's replica count pass review and fail at peak. Compute from `maxReplicas` plus surge, and put the result in the service's readiness review ([[production-readiness-review]]).

## Sidecar versus shared pooler

| Aspect             | Sidecar (one PgBouncer per app pod)                             | Shared Deployment (a few PgBouncer pods)                          |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Connection count   | Scales with pods, so you still need small pools                 | Scales with pooler replicas; constant as the app scales           |
| Blast radius       | One pod                                                         | All clients if the pooler pods fail                               |
| Latency            | Loopback, no extra network hop                                  | One extra in-cluster hop                                          |
| Operational weight | Every pod carries another container, more image and CVE surface | A single Deployment to patch, scale and monitor                   |
| Isolation per team | Natural                                                         | Needs one pooler per team or database, and NetworkPolicy          |
| Failure handling   | Restarts with the pod                                           | Needs a PodDisruptionBudget, spread across zones, readiness probe |

Choose the **shared Deployment** by default for autoscaled workloads, with at least two replicas spread across zones and a PodDisruptionBudget. Choose a **sidecar** when you have a handful of fixed-size pods, you want per-pod isolation, or the extra hop matters. Do not mix both for the same database without a budget that counts both.

Limit who can reach the shared pooler with a NetworkPolicy ([[kubernetes-network-policies]]), because the pooler holds credentials that can open server connections.

## Transaction versus session mode and what breaks

PgBouncer pool modes decide when a server connection goes back to the pool.

- **Session mode**: the connection is held for the whole client session. Safe for every feature, but the pool saves little because clients usually stay connected.
- **Transaction mode**: the connection is held only during a transaction. This is where the saving is, and it is the mode used in this note.
- **Statement mode**: one statement at a time; no multi-statement transactions. Rarely suitable.

In transaction mode the next transaction may use a different server connection, so anything that stores state on the connection breaks or behaves oddly.

| Feature                                                 | In transaction mode                                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SET` / `SET SESSION` (search_path, timeouts, role)     | Lost or leaks to another client. Use `SET LOCAL` inside a transaction.                                                                                                                                |
| Session-level advisory locks (`pg_advisory_lock`)       | Unsafe. Use transaction-level locks (`pg_advisory_xact_lock`).                                                                                                                                        |
| `LISTEN` / `NOTIFY`                                     | Does not work reliably. Use a direct connection for listeners.                                                                                                                                        |
| Temporary tables, `WITH HOLD` cursors                   | Break across transactions.                                                                                                                                                                            |
| Protocol-level prepared statements                      | Historically broken; newer PgBouncer versions may support them. Not verified: which version added it and which settings it needs. Test your driver, or disable server-side prepared statements in it. |
| `pg_dump`, logical replication, long-running migrations | Use a direct (or session-mode) connection.                                                                                                                                                            |

Give migrations and administrative tools their own database alias in session mode, so the application keeps the cheap transaction pool. That keeps expand and contract steps ([[postgres-expand-contract-migrations]]) from holding shared connections for minutes.

Test the application's driver settings in staging. Many Java, Go and Node drivers cache prepared statements by default, and the failure is intermittent, which makes it painful in production.

## Auth Proxy placement

The Cloud SQL Auth Proxy provides IAM-authorised, encrypted connections to the instance without managing certificates or IP allowlists. On GKE it runs as a container and uses Workload Identity, so no key file is needed ([[gke-workload-identity]]).

Place it **between PgBouncer and Cloud SQL**: application, then PgBouncer, then Auth Proxy, then Cloud SQL. The pooler talks plain TCP to the proxy on loopback; the proxy handles TLS and IAM. Put the proxy in the same pod as PgBouncer (a two-container pod), so the pair scales and fails together.

```text
app pod  --6432-->  PgBouncer  --127.0.0.1:5432-->  Auth Proxy  --TLS-->  Cloud SQL
```

Do not run a proxy in every application pod as well as the pooler. Each proxy is its own connection origin and doubles what you have to monitor. Use private IP and a private cluster so the proxy reaches the instance without the public internet ([[private-gke-and-controlled-egress]]). Not verified: proxy flag names such as `--private-ip` and `--port`, and the image tag. Read `cloud-sql-proxy --help` for your version and pin the image by digest.

## The configuration

Store the PgBouncer settings in a ConfigMap. The pool numbers match the example above; change them from your own budget.

```ini title="pgbouncer.ini"
; CHANGE: database name and the budget-derived pool sizes.
[databases]
appdb         = host=127.0.0.1 port=5432 dbname=appdb
appdb_migrate = host=127.0.0.1 port=5432 dbname=appdb pool_mode=session pool_size=2

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
; Disable the unix socket: with readOnlyRootFilesystem the default socket directory
; (/tmp) is not writable. Alternatively mount an emptyDir at /tmp.
unix_socket_dir =

auth_type = scram-sha-256
auth_file = /etc/pgbouncer-auth/userlist.txt

pool_mode = transaction
max_client_conn = 2000
default_pool_size = 20
reserve_pool_size = 5
reserve_pool_timeout = 3
max_db_connections = 40

server_idle_timeout = 600
query_wait_timeout = 120
ignore_startup_parameters = extra_float_digits

admin_users = pgbouncer_admin
stats_users = pgbouncer_stats

; Server side runs through the Auth Proxy on loopback, which handles TLS.
server_tls_sslmode = disable
```

`max_client_conn 2000` is the number of application connections PgBouncer accepts; it is cheap compared with server connections. `default_pool_size 20` and `reserve_pool_size 5` apply per database and user pair. `max_db_connections` caps the server connections per database from one PgBouncer and is the number you multiply by the pooler replicas for the budget. It is the hard cap per database across all users, so it is the number to budget: set it equal to or below what the pool settings add up to. With the pool settings above (20 plus a reserve of 5, so 25 per pooler), 4 poolers during a rollout give 100; a cap of 40 per pooler would allow up to 160 and, with a reserve of 20, still fits in 200, but it is looser than the pool settings alone unless several users share the database. Set it deliberately.

The `auth_file` holds the database users and their password verifiers. Mount it from a Kubernetes Secret created by [[external-secrets-with-secret-manager]], never from the repository. Check the PgBouncer documentation for the file format and which verifier forms `scram-sha-256` accepts. Not verified here.

### Shared Deployment

This Deployment runs PgBouncer and the Auth Proxy in one pod. Replace images with pinned, scanned copies from your Artifactory ([[artifact-promotion-artifactory]]); the tags here are placeholders.

```yaml title="pgbouncer-deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pgbouncer-appdb
  namespace: data-access
  labels:
    app.kubernetes.io/name: pgbouncer-appdb
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: pgbouncer-appdb
  strategy:
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app.kubernetes.io/name: pgbouncer-appdb
    spec:
      # CHANGE: a Kubernetes ServiceAccount bound to a Google identity with roles/cloudsql.client.
      serviceAccountName: pgbouncer-appdb
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: pgbouncer-appdb
      containers:
        - name: pgbouncer
          # CHANGE: your pinned pgbouncer image.
          image: registry.example.com/platform/pgbouncer:<pinned-version>
          args: ["/etc/pgbouncer/pgbouncer.ini"]
          ports:
            - name: pgbouncer
              containerPort: 6432
          readinessProbe:
            tcpSocket:
              port: 6432
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            tcpSocket:
              port: 6432
            initialDelaySeconds: 15
            periodSeconds: 10
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 256Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: config
              mountPath: /etc/pgbouncer
              readOnly: true
            - name: auth
              mountPath: /etc/pgbouncer-auth
              readOnly: true
        - name: cloud-sql-proxy
          # CHANGE: your pinned Cloud SQL Auth Proxy image.
          image: registry.example.com/platform/cloud-sql-proxy:<pinned-version>
          args:
            - "--private-ip"
            - "--address=127.0.0.1"
            - "--port=5432"
            # CHANGE: PROJECT:REGION:INSTANCE
            - "example-project:europe-west1:orders-prod"
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 128Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
      volumes:
        - name: config
          configMap:
            name: pgbouncer-appdb-config
        - name: auth
          secret:
            secretName: pgbouncer-appdb-auth
---
apiVersion: v1
kind: Service
metadata:
  name: pgbouncer-appdb
  namespace: data-access
spec:
  selector:
    app.kubernetes.io/name: pgbouncer-appdb
  ports:
    - name: pgbouncer
      port: 6432
      targetPort: pgbouncer
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: pgbouncer-appdb
  namespace: data-access
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: pgbouncer-appdb
```

The `readinessProbe` is a TCP check on 6432: it proves PgBouncer is accepting connections, not that the database behind it is reachable. That is intentional, because a database outage should not take every pooler pod out of rotation and hide the real error; monitor database reachability separately. Set memory limits and requests as described in [[kubernetes-resource-requests-and-limits]]. PgBouncer is single-threaded, so more CPU does not help one process; add replicas.

Applications point at `pgbouncer-appdb.data-access.svc.cluster.local:6432` with a short-lived, small application pool (a few connections per pod is plenty), because the pooler does the real pooling.

## Monitoring and alerts

Look inside PgBouncer with its admin console. Connect to the special `pgbouncer` database as an admin user.

```bash
# CHANGE: host and admin user. Run from a debug pod in the cluster.
psql "host=pgbouncer-appdb.data-access.svc.cluster.local port=6432 dbname=pgbouncer user=pgbouncer_admin" \
  -c "SHOW POOLS;" \
  -c "SHOW CLIENTS;" \
  -c "SHOW STATS;"
```

```text title="Illustrative SHOW POOLS output"
 database | user |  cl_active | cl_waiting | sv_active | sv_idle | sv_used | maxwait
----------+------+------------+------------+-----------+---------+---------+--------
 appdb    | app  |         87 |          0 |        14 |       6 |       0 |       0
```

What to read:

- `cl_active`: clients currently linked to a server connection.
- `cl_waiting`: clients waiting for a server connection. Above 0 for long means the pool is too small, queries are slow, or a lock holds connections.
- `sv_active`, `sv_idle`: server connections in use and idle. Their sum must stay under `max_db_connections`.
- `maxwait`: how long the oldest waiting client has waited, in seconds. Column names can differ between versions; check your output.
- `SHOW CLIENTS` lists each client, which helps find a service or address that opens too many.

Export the numbers with a PgBouncer exporter and alert from Prometheus. The metric names depend on the exporter; the one below is a placeholder to replace.

```yaml title="pgbouncer-alerts.yaml"
groups:
  - name: pgbouncer
    rules:
      - alert: PgBouncerClientsWaiting
        # CHANGE: metric name and labels to your exporter's.
        expr: sum by (database) (pgbouncer_pools_client_waiting_connections) > 0
        for: 5m
        labels:
          severity: ticket
        annotations:
          summary: Clients are waiting for a PgBouncer server connection for 5 minutes.
          description: Check SHOW POOLS and SHOW CLIENTS, slow queries and locks, then the pool size and the connection budget.
```

Also watch the database side: the number of backends on the Cloud SQL instance against `max_connections` (the Cloud SQL metrics include a backends count; confirm its name in Cloud Monitoring). Alert on it above 80% of the budget, which gives time to act. Tie these to the service's SLOs ([[slo-burn-rate-alerting]]) and keep the pooler in your capacity reviews.

## Rollout

1. **Measure first.** Record current connection use per service and the database `max_connections`. Compute the budget with `maxReplicas` and surge.
2. **Stage.** Deploy the pooler to staging with the staging flag values. Run the application's load test ([[load-and-performance-testing]]; [[timeouts-retries-load-shedding]] for client timeouts) and check for session-state failures in the table above.
3. **Shrink the application pool.** Lower each pod's pool size to the small value you budgeted. Leaving a large pool in the application just moves the queue inside the pod.
4. **Canary.** Point one service at the pooler by changing only its connection string, in a Helm value ([[helm-chart-conventions]]). Watch `cl_waiting`, error rate and latency for a full business cycle.
5. **Move services one at a time**, and recompute the budget after each.
6. **Migrations and tools** use the session-mode alias or a direct connection.
7. **Roll back** by pointing the connection string back at the Auth Proxy endpoint. Keep the direct path working for at least one release, and check that the budget still holds with both paths in use.

Review the budget whenever an HPA maximum, replica count or database tier changes, and add the check to your service review checklist.

## Related

- [[kubernetes-resource-requests-and-limits]]
- [[postgres-expand-contract-migrations]]
- [[kubernetes-autoscaling]]
- [[gke-workload-identity]]
- [[external-secrets-with-secret-manager]]
- [[zero-downtime-deployments-kubernetes]]
- [[production-readiness-review]]
