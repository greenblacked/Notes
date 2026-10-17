---
title: "Containers 03: Building and shipping images: Dockerfiles, registries and image security"
description: Write small, cache-friendly, non-root Dockerfiles, tag and pin images in a registry, keep secrets out of layers and scan and harden what you ship.
type: guide
tags:
  - learning
  - docker
  - security
  - supply-chain
  - ci-cd
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 8 h | You need: [[learn/running-and-debugging-containers|Containers 02: Running, inspecting and debugging containers]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]], with Docker installed (Google Cloud steps use the sandbox project and are optional)

Until now you ran images other people built. In a team you build your own, and a bad image is expensive: slow builds, gigabytes pulled on every deploy, secrets frozen into layers, a root user that makes an attack worse. This lesson covers the whole path from a `Dockerfile` to a tagged, scanned image in a registry. It has two halves: **building** (instructions, cache, context, multi-stage) and **shipping** (registries, tags, digests, multi-architecture, secrets, scanning and runtime hardening).

## What you will learn

- What each Dockerfile instruction does and which ones create layers, and how to order them so rebuilds take seconds.
- How the build context and `.dockerignore` affect speed and secrecy.
- How to choose a base image (`slim`, Alpine, distroless, `scratch`) and what each trade-off costs.
- How to write a multi-stage build that ends as a small, non-root image with an exec-form entrypoint.
- How registry names, tags and digests work, and a tag strategy that makes a deploy reproducible.
- How to keep secrets out of layers, scan an image, and run it with a read-only filesystem, no capabilities and resource limits.

## Part 1: building an image

### What `docker build` does

`docker build -t NAME:TAG .` takes a **build context** (the directory you name, here `.`) and a **Dockerfile**, and produces an image. The builder reads the Dockerfile top to bottom, runs each instruction on top of the result of the previous one, and stores the file changes as layers (see [[learn/containers-under-the-hood|Containers 01]]). Current Docker uses **BuildKit** as its builder. BuildKit builds independent stages in parallel, caches aggressively and supports secret mounts.

Two flags help when something goes wrong. `--progress=plain` prints every step's full output instead of a compact view, and `--no-cache` ignores the cache. A first line such as `# syntax=docker/dockerfile:1` selects the Dockerfile frontend version, which gives you current syntax (pin a specific version in production if you need exact reproducibility).

### The instructions and what they do

| Instruction   | Purpose                                                    | New layer?                                     |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `FROM`        | Start from a base image; starts a new stage                | Base layers                                    |
| `RUN`         | Run a command at build time (install, compile)             | Yes                                            |
| `COPY`        | Copy files from the build context (or another stage) in    | Yes                                            |
| `ADD`         | Like `COPY`, plus URLs and unpacking local tar files       | Yes                                            |
| `WORKDIR`     | Set the working directory (and create it)                  | Metadata (the directory is created in a layer) |
| `ENV`         | Set an environment variable, at build time and at run time | Metadata only                                  |
| `ARG`         | A build-time variable, set with `--build-arg`              | Metadata only                                  |
| `USER`        | Run later instructions and the container as this user      | Metadata only                                  |
| `EXPOSE`      | Document a listening port (does not publish it)            | Metadata only                                  |
| `LABEL`       | Add key/value metadata                                     | Metadata only                                  |
| `HEALTHCHECK` | Define the health command                                  | Metadata only                                  |
| `ENTRYPOINT`  | The program the container runs                             | Metadata only                                  |
| `CMD`         | The default arguments (or default command)                 | Metadata only                                  |

Only instructions that change files (`RUN`, `COPY`, `ADD`) make layers with content. Every layer stays in the image forever, which is why what you do in a layer matters.

### The build context and `.dockerignore`

The **context** is everything in the directory you pass to `docker build`. The CLI sends it to the builder first, before running any instruction. If the directory contains `.git`, `node_modules`, test data, a 2 GB video or a `.env` file, they are all sent, slow the build, and `COPY . .` will put them in the image.

A `.dockerignore` file next to the Dockerfile lists what to leave out, with the same style as `.gitignore`:

```text title=".dockerignore"
.git
.gitignore
.env
*.env
*.pem
node_modules
__pycache__
*.log
Dockerfile*
.dockerignore
```

Two reasons to keep it strict. **Speed:** a small context uploads in milliseconds. **Secrets:** a `.dockerignore` stops `.env` files and keys from ever being copied into a layer by a broad `COPY . .`. Ignoring `Dockerfile` itself is fine, because the builder reads it separately.

### Choosing a base image (`FROM`)

| Base                      | Typical size (illustrative) | Strengths                                            | Costs                                                                                     |
| ------------------------- | --------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Full (`debian`, `ubuntu`) | 80 MB and up                | Familiar, many tools, glibc                          | Large, more packages to patch                                                             |
| `-slim` variants          | Tens of MB                  | glibc compatible, smaller                            | Few tools; you install what you need                                                      |
| Alpine                    | A few MB                    | Very small, has a shell and a package manager        | Uses **musl** libc, not glibc: some prebuilt binaries and Python wheels break or are slow |
| Distroless                | A few MB to tens of MB      | No shell, no package manager: smaller attack surface | Harder to debug (see [[learn/running-and-debugging-containers\|Containers 02]]); no `apt` |
| `scratch`                 | 0 (an empty image)          | Only your static binary                              | No CA certificates, no timezone data, no `/etc/passwd` unless you copy them in            |

Pick the smallest base that your application actually runs on, and that your team can debug. For compiled static programs (Go, Rust), distroless or `scratch` fits well. For Python or Node with native packages, `-slim` is the safer start; Alpine is smaller but can cost hours when a package expects glibc.

Pin the base to a specific tag, and for strict reproducibility to a digest (see below). `FROM python` means "whatever is latest today".

### `RUN`, `COPY`, `ADD`, `WORKDIR`

- **`RUN`** executes a command in a new layer. Chain related steps with `&&` and clean up **in the same `RUN`**, because a later delete does not shrink the image (Containers 01): `RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*`. `--no-install-recommends` skips optional packages.
- **`COPY`** is the default way to add files. It does exactly what it says.
- **`ADD`** also fetches URLs and auto-extracts local archives, which makes it surprising. Prefer `COPY`, and use `ADD` only for the archive feature. For downloads, use `RUN curl` with a checksum check.
- **`WORKDIR`** sets (and creates) the directory for later instructions. Use it instead of `RUN cd ...`, which affects only that one `RUN`.

### `ENV` and `ARG`

Both set variables, but with different lifetimes:

|                                    | `ARG`                                                | `ENV`                                             |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Available during build             | Yes, after it is declared                            | Yes, after it is declared                         |
| Available in the running container | **No**                                               | **Yes**                                           |
| Set with                           | `--build-arg NAME=value`                             | In the Dockerfile; override with `-e` at run time |
| Scope                              | From the line it is declared to the end of its stage | The same, and it persists into the image          |

`ARG` is for build-time choices such as a version number. `ENV` is for run-time configuration. **Neither is a safe place for a secret**, as you will see in the secrets section. An `ARG` declared before the first `FROM` is visible only to `FROM` lines; redeclare it inside a stage to use it there.

### Cache order: the most useful habit

Each instruction's result is cached. The cache for a step is reused if the instruction and all inputs (for `COPY`, the content of the files) are unchanged **and every earlier step was also reused**. The first step that changes invalidates every step after it.

So put things that change **rarely** first and things that change **often** last. The classic pattern is "dependency manifest first, source later":

```dockerfile
COPY go.mod ./           # changes rarely
RUN go mod download      # slow; cached while go.mod is unchanged
COPY . .                 # changes on every edit
RUN go build ...         # re-runs on every edit, but the download above is cached
```

If you wrote `COPY . .` first, a one-line source edit would invalidate the download step and re-fetch every dependency on every build. In CI this is the difference between a 20-second and a 5-minute build.

### `ENTRYPOINT` and `CMD`

Both define what runs. **`ENTRYPOINT`** is the program; **`CMD`** is the default arguments (or the default command when there is no entrypoint). Arguments after the image name in `docker run IMAGE ARGS` replace `CMD`. Always use the **exec form**, the JSON array:

```dockerfile
ENTRYPOINT ["hello"]
CMD ["--port", "8080"]
```

The shell form (`CMD hello --port 8080`) wraps your program in `/bin/sh -c`, which becomes PID 1 and does not forward signals ([[learn/running-and-debugging-containers|Containers 02]]). With the exec form your program is PID 1 and receives `SIGTERM` itself. The program must handle the signal.

### `USER`, `EXPOSE`, `LABEL`, `HEALTHCHECK`

- **`USER`**: run as a non-root user. Use a **numeric UID** (`USER 10001:10001`), not a name. Kubernetes can check "runs as non-root" only when it can see a number, and a name needs an entry in `/etc/passwd`. Create the user in the image, give it ownership of what it must write, and nothing else. See [[patterns/dockerfile-hardening]].
- **`EXPOSE`**: documents the port. It publishes nothing.
- **`LABEL`**: metadata, such as the OCI keys `org.opencontainers.image.source` (the repository URL) and `org.opencontainers.image.revision` (the Git commit). They let you trace a running image back to its source.
- **`HEALTHCHECK`**: a command Docker runs on a timer. Keep it cheap. Kubernetes ignores the Dockerfile `HEALTHCHECK` and uses its own probes ([[learn/kubernetes-probes-resources-and-debugging|Kubernetes 05]]).

### Multi-stage builds

A build needs compilers, headers and caches. A running application does not. A **multi-stage build** uses several `FROM` lines: build in a big stage, then copy only the result into a small final stage. Everything else is thrown away with the build stage.

Here is the small Go service used by the exercises, with a Dockerfile that builds it and runs it as a non-root user:

```go title="main.go"
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "hello from the lab")
	})
	srv := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	log.Println("listening on :8080")

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Println("stopped")
}
```

```text title="go.mod"
module example.com/hello

go 1.22
```

```dockerfile title="Dockerfile"
# syntax=docker/dockerfile:1

# ---- build stage: has the compiler, is thrown away ----
# change: a supported Go release, see the official golang image page
ARG GO_VERSION=1.23
FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/hello .

# ---- final stage: small, non-root ----
# change: a supported Alpine release, see the official alpine image page
ARG ALPINE_VERSION=3.20
FROM alpine:${ALPINE_VERSION}
RUN addgroup -g 10001 -S app && adduser -S -u 10001 -G app -H -s /sbin/nologin app
COPY --from=build /out/hello /usr/local/bin/hello
USER 10001:10001
EXPOSE 8080
LABEL org.opencontainers.image.title="hello"
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
ENTRYPOINT ["hello"]
```

The final image contains Alpine, one small binary and one unprivileged user. It does not contain the Go toolchain, the source or the module cache. `CGO_ENABLED=0` makes the binary static, so it does not depend on glibc or musl.

> [!warning] Check before relying on this
> The tags `golang:1.23-alpine`, `alpine:3.20` and `debian:bookworm-slim` here and in the exercises are examples that may already be out of support. Go, Alpine and Debian release new lines, and old lines stop receiving security fixes. Before you use any of this, replace each tag with a currently supported one from the official image pages (and the exercises still work with any supported tag). Do not copy these tags into a real project.

## Part 2: shipping an image

### Registry names, tags and digests

A **registry** stores images. A full image reference has up to four parts:

```text
europe-docker.pkg.dev/my-project/apps/hello:1.4.2@sha256:0123abcd...
└───── registry ─────┘ └ namespace ┘ └repo┘ └tag┘ └──── digest ────┘
```

- **Registry**: the host. Without one, Docker means Docker Hub. On Google Cloud, **Artifact Registry** uses `LOCATION-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE`. Teams that use JFrog run **Artifactory** the same way ([[patterns/artifact-promotion-artifactory]]).
- **Tag**: a human-friendly, _movable_ label. If you omit it, Docker uses `latest`, which has no special meaning other than being the default.
- **Digest**: `sha256:...`, the hash of the image manifest. It identifies exact content and cannot be moved.

### A tag strategy that works

- **Release tags are immutable.** `1.4.2` is pushed once and never overwritten. Some registries can enforce this; if yours cannot, enforce it in the pipeline.
- **Tag with the Git commit too** (`sha-3f2a9c1` or the full SHA), so any running image maps to one commit.
- **Never deploy `latest` to production.** Two nodes can pull it at different times and run different code, and you cannot say what is running or roll back to "the previous latest".
- **Deploy by digest when it matters.** A manifest that says `hello@sha256:...` always runs those bytes. Tools such as Renovate or Dependabot can propose digest updates ([[patterns/automated-dependency-updates]]).
- **Promote, do not rebuild.** Build once, then promote the same digest from a dev repository to staging to production ([[patterns/artifact-promotion-artifactory]]). Rebuilding can produce a different image.

### Pinning by digest

```bash
docker pull alpine:3.20
docker image inspect alpine:3.20 --format '{{index .RepoDigests 0}}'
```

```text
alpine@sha256:5e6f1c0d...7a8b
```

_Illustrative: the digest is shortened and differs per tag, date and image store._

Use the digest in a Dockerfile as `FROM alpine:3.20@sha256:<digest>`. Docker checks the digest; the tag is now documentation. The trade-off: a pinned digest never receives base-image security fixes by itself. Pair pinning with an automatic update tool and a rebuild schedule.

### Multi-architecture images

Servers may be `linux/amd64` and laptops or cheaper cloud machines `linux/arm64`. A multi-architecture image is an **image index** (a manifest list) that points to one image per platform; `docker pull` picks the matching one. Inspect one with:

```bash
docker buildx imagetools inspect alpine:3.20
```

```text
Name:      docker.io/library/alpine:3.20
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:5e6f1c0d...7a8b

Manifests:
  Name:      docker.io/library/alpine:3.20@sha256:aaaa...
  MediaType: application/vnd.oci.image.manifest.v1+json
  Platform:  linux/amd64
  ...
  Platform:  linux/arm64
```

_Illustrative: the list of platforms and the digests differ by image and over time._

You build one with `docker buildx build --platform linux/amd64,linux/arm64 -t REGISTRY/IMAGE:TAG --push .`. That needs a builder that supports multi-platform output and, for the foreign platform, either emulation (QEMU, slow) or native build nodes. A binary you cross-compile in the build stage (Go does this well) avoids emulation.

> [!warning] Check before relying on this
> Buildx flags and which builders support multi-platform output depend on your Docker and buildx versions and on the image store in use (the classic store needs a `docker-container` builder; the containerd image store can do more on its own). Read `docker buildx build --help` for your version before you automate it.

### Making images smaller

Smaller images pull faster, start faster and have less to patch. The levers, in order of effect:

1. **Multi-stage build**, so tools never reach the final image.
2. **A smaller base** that still runs your application.
3. **Clean up in the same `RUN`** that created the mess (package lists, caches, downloaded archives).
4. **`--no-install-recommends`** on `apt-get`, and `--no-cache` on `apk add`.
5. **A good `.dockerignore`**, so you never copy what you do not need.

Find where the bytes are with `docker history IMAGE`: it lists each layer, the instruction that made it and its size. A big layer next to a harmless instruction is the place to look.

### Secrets do not belong in layers

Anything you put in a layer or in image metadata can be read by anyone who can pull the image. Typical leaks:

- **`COPY .env .`** or `COPY . .` with secrets in the context. Fix: `.dockerignore`, and do not bake secrets in at all.
- **`ENV TOKEN=...`** is stored in the image config, visible with `docker inspect`.
- **`ARG TOKEN`** feels temporary but is not safe either. Build arguments can be recorded in the image history and build metadata. Whether the value appears in `docker history` depends on the builder and settings, so assume that it does.
- **`RUN curl -H "Authorization: $TOKEN" ...`** puts the command (and sometimes the value) into history.

The right tool is a **secret mount**. BuildKit mounts the secret as a file for one `RUN` only. It is not written to any layer:

```dockerfile
# syntax=docker/dockerfile:1
FROM alpine:3.20
RUN --mount=type=secret,id=api_token \
    wc -c < /run/secrets/api_token
```

```bash
docker build --secret id=api_token,src=./token.txt -t c3-secret:ok .
```

The secret exists at `/run/secrets/api_token` during that `RUN` and is gone afterwards. For secrets the _running_ app needs, inject them at run time (environment from your orchestrator, mounted files, a secret manager) and never at build time. See [[patterns/external-secrets-with-secret-manager]] and, if one leaks anyway, [[runbooks/leaked-credential-rotation]].

### Build caches in CI

CI runners often start empty, so the local cache is lost. BuildKit can store the cache in the registry and reuse it:

```bash
docker buildx build \
  --cache-from type=registry,ref=REGISTRY/IMAGE:buildcache \
  --cache-to   type=registry,ref=REGISTRY/IMAGE:buildcache,mode=max \
  -t REGISTRY/IMAGE:TAG --push .
```

`mode=max` also caches intermediate stages. This needs a builder that supports the registry cache backend. Good layer order is still the first optimisation; a registry cache comes second.

### Scanning, SBOMs and signing

An image contains many packages, and some will have known vulnerabilities. A scanner such as **Trivy** or **Grype** compares an image's contents with vulnerability databases and reports what it finds. Treat a scan as a signal, not a verdict: a finding can be unreachable in your use, and a clean scan is only as good as the database that day.

Three related ideas:

- **SBOM** (software bill of materials): a list of the packages inside an image. It lets you answer "do we run the vulnerable library?" quickly. Tools such as `syft` and Trivy can produce one, and BuildKit can attach one during `docker buildx build` (check the flags for your version).
- **Provenance**: a signed statement of _how_ an image was built (the source, the builder). BuildKit can attach it.
- **Signing**: with a tool such as **cosign** you sign the image digest, and the cluster verifies the signature before running it.

A CI gate typically fails the build on fixable findings of `HIGH` or `CRITICAL` severity, uploads the report, and re-scans stored images on a schedule, since new vulnerabilities are found after you ship. See [[patterns/dockerfile-hardening]] for the practice and [[runbooks/leaked-credential-rotation]] when the finding is a leaked key.

### Runtime hardening

The image is half the story. How you run it matters as much. These flags restrict a container well beyond Docker's defaults:

| Flag                               | Effect                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `--user 10001:10001`               | Run as an unprivileged user, whatever the image says                         |
| `--read-only`                      | Make the root filesystem read-only                                           |
| `--tmpfs /tmp`                     | Give the app a writable, memory-backed `/tmp` while the rest stays read-only |
| `--cap-drop ALL`                   | Remove all Linux capabilities; add back only what is needed with `--cap-add` |
| `--security-opt no-new-privileges` | Stop a process gaining privileges through setuid binaries                    |
| `--memory 128m --cpus 0.5`         | Limit memory and CPU (cgroups, see Containers 01)                            |
| `--pids-limit 100`                 | Limit processes, to stop a fork bomb                                         |

Kubernetes has the same controls in `securityContext` and Pod Security admission ([[patterns/pod-security-admission]]).

### Artifact Registry on Google Cloud

For the lab stack, use Artifact Registry. These commands create a Docker repository and push the image. Replace `PROJECT_ID` with your sandbox project and choose a region close to you.

> [!warning] Costs money
> An Artifact Registry repository stores images and charges for storage and network egress beyond free allowances. A few small test images cost very little, but delete the repository when you finish. Cleanup: `gcloud artifacts repositories delete "$REPO" --location="$REGION" --project="$PROJECT_ID"` (with the variables set below). Check current pricing before you leave anything running.

```bash
export PROJECT_ID="my-sandbox-project"      # change: your sandbox project ID
export REGION="europe-west1"                # change: a region near you
export REPO="lab-images"

gcloud services enable artifactregistry.googleapis.com --project="$PROJECT_ID"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" --project="$PROJECT_ID"
gcloud auth configure-docker "${REGION}-docker.pkg.dev"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/hello"
docker tag c3-hello:1 "${IMAGE}:1.0.0"
docker push "${IMAGE}:1.0.0"
gcloud artifacts docker images list "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
```

`gcloud auth configure-docker` writes a credential helper into your Docker config so `docker push` uses your `gcloud` login. In CI, use a service account with the narrowest role (writer on one repository) and prefer Workload Identity Federation over key files ([[learn/gcp-iam-and-service-accounts|GCP 02]]).

> [!warning] Check before relying on this
> Artifact Registry options such as immutable tags, cleanup policies and vulnerability scanning change over time and some are billed separately. Confirm each in the current Artifact Registry documentation before you rely on it.

## Hands-on exercises

Use your Ubuntu VM with Docker. Work in `~/c3`. Names start with `c3-`.

> [!warning] Exercises are not verified
> The commands and outputs were written from the Docker documentation and were not run for this page (no `verified` date). Output is illustrative: sizes, IDs, timings and digests differ. Exercises that pull from the internet (Go, Alpine, Debian, Trivy) need network access and can hit rate limits.

**Part A: Dockerfile**

1. **Create the project and build it twice.** Save `main.go`, `go.mod` and `Dockerfile` from above in `~/c3/hello`, then:

   ```bash
   mkdir -p ~/c3/hello && cd ~/c3/hello
   # (save the three files here)
   docker build --progress=plain -t c3-hello:1 .
   docker build --progress=plain -t c3-hello:1 .
   ```

   Expected: the first build runs every step (it pulls `golang` and `alpine`, which takes a while). The second build finishes in about a second, and every step shows `CACHED`.
   If you see something else: if steps rebuild the second time, a file in the context changed (an editor swap file, a log). Add a `.dockerignore`. If the pull fails with `manifest unknown`, the base tag does not exist any more: use a current supported tag.

2. **Change the source and watch only later steps rebuild.**

   ```bash
   sed -i 's/hello from the lab/hello again/' main.go
   docker build --progress=plain -t c3-hello:2 . 2>&1 | grep -E 'CACHED|RUN|COPY'
   ```

   Expected: the steps up to and including `RUN go mod download` show `CACHED`. The steps `COPY . .` and `RUN ... go build` run again, and the later copy into the final stage runs.
   If you see something else: if `go mod download` also reruns, `go.mod` changed or `COPY . .` comes before it in your file. Put the manifest copy first.

3. **Compare a single-stage and a multi-stage image.**

   ```bash
   cat > Dockerfile.single <<'DOCKER'
   # change: a supported Go release, see the official golang image page
   ARG GO_VERSION=1.23
   FROM golang:${GO_VERSION}-alpine
   WORKDIR /src
   COPY . .
   RUN CGO_ENABLED=0 go build -o /usr/local/bin/hello .
   ENTRYPOINT ["hello"]
   DOCKER
   docker build -f Dockerfile.single -t c3-hello:single .
   docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep c3-hello
   ```

   Expected: `c3-hello:single` is hundreds of megabytes (it contains the Go toolchain); `c3-hello:2` is a small fraction of that, in the tens of megabytes or less.
   If you see something else: a smaller gap means the Go image you used is small, or the size column shows a compressed figure. Use `docker image inspect IMAGE --format '{{.Size}}'` on both. The order of magnitude (tool-chain versus no tool-chain) is the point.

4. **Check the user.**

   ```bash
   docker run --rm --entrypoint id c3-hello:2 -u
   docker run -d --name c3-run -p 127.0.0.1:8080:8080 c3-hello:2
   curl -s http://127.0.0.1:8080/
   docker exec c3-run id
   ```

   Expected: `10001`, then `hello again`, then `uid=10001(app) gid=10001(app) groups=10001(app)`.
   If you see something else: `0` means the `USER` line is missing or placed before the last stage. If `curl` fails, wait a second for the server to start, or check `docker logs c3-run`.

5. **See PID 1 in shell form and exec form.**

   ```bash
   docker rm -f c3-run
   cat > Dockerfile.shell <<'DOCKER'
   FROM c3-hello:2
   ENTRYPOINT []
   CMD echo starting && hello
   DOCKER
   docker build -f Dockerfile.shell -t c3-hello:shell .
   docker run -d --name c3-shell c3-hello:shell
   docker run -d --name c3-exec c3-hello:2
   docker exec c3-shell ps -o pid,args
   docker exec c3-exec ps -o pid,args
   time docker stop c3-shell c3-exec
   ```

   Expected: in `c3-shell`, PID 1 is `/bin/sh -c echo starting && hello` and `hello` is a child with a higher PID. In `c3-exec`, PID 1 is `hello`. The `time docker stop` step takes about ten seconds in total: `c3-exec` stops at once because `hello` handles `SIGTERM`, while `c3-shell` waits for the grace period and is then killed (if your shell replaced itself with `hello`, both stop quickly).
   If you see something else: if the shell variant also shows `hello` as PID 1, your shell replaced itself with the last command; that is allowed but not guaranteed, so do not rely on it. If `ps -o` is unsupported, run `docker top NAME`.

6. **Shrink the context.**

   ```bash
   cd ~/c3/hello
   head -c 104857600 /dev/urandom > junk.bin
   docker build --progress=plain -t c3-hello:ctx . 2>&1 | grep -i 'transferring context'
   printf 'junk.bin\n.git\n*.env\nDockerfile*\n' > .dockerignore
   docker build --progress=plain -t c3-hello:ctx . 2>&1 | grep -i 'transferring context'
   rm junk.bin
   ```

   Expected: the first build transfers about 100 MB of context; the second transfers a few kilobytes. (A cached build may print less; run `docker build --no-cache` if you see no figure.)
   If you see something else: if both are tiny, BuildKit sent only the files `COPY` needs; this happens with some builder versions. Try `docker build --no-cache --progress=plain`, and check `docker buildx version`.

**Part B: registries and security**

7. **Inspect the platforms of a public image.**

   ```bash
   docker buildx imagetools inspect alpine:3.20 | grep -E 'Name:|Platform:' | head -12
   ```

   Expected: a list of manifests, each with a `Platform:` line such as `linux/amd64` and `linux/arm64`.
   If you see something else: `docker: 'buildx' is not a docker command` means the plugin is not installed (see the Docker install page for your OS). A single manifest means the image is single-architecture.

8. **Pin by digest.**

   ```bash
   docker pull alpine:3.20
   D=$(docker image inspect alpine:3.20 --format '{{index .RepoDigests 0}}')
   echo "$D"
   docker run --rm "$D" echo "pinned ok"
   ```

   Expected: a reference of the form `alpine@sha256:...` and then `pinned ok`.
   If you see something else: `index out of range` means the image has no repo digest (it was built locally). Pull a registry image instead. If the digest differs from a colleague's, you may have pulled a different platform's image or a newer build of the tag.

9. **Reduce an image's size with one `RUN`.**

   ```bash
   mkdir -p ~/c3/size && cd ~/c3/size
   cat > Dockerfile.bad <<'DOCKER'
   # change: a supported Debian release, see the official debian image page
   ARG DEBIAN_VERSION=bookworm-slim
   FROM debian:${DEBIAN_VERSION}
   RUN apt-get update
   RUN apt-get install -y curl
   RUN rm -rf /var/lib/apt/lists/*
   DOCKER
   cat > Dockerfile.good <<'DOCKER'
   # change: a supported Debian release, see the official debian image page
   ARG DEBIAN_VERSION=bookworm-slim
   FROM debian:${DEBIAN_VERSION}
   RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
   DOCKER
   docker build -f Dockerfile.bad  -t c3-size:bad  .
   docker build -f Dockerfile.good -t c3-size:good .
   docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep c3-size
   docker history c3-size:bad | head -6
   ```

   Expected: `c3-size:good` is noticeably smaller. In `docker history` for `bad`, the `apt-get update` layer holds the package lists and the `rm` layer shows `0B`: the data is still in the earlier layers.
   If you see something else: if the sizes are close, the base tag may already ship without cached lists, or the recommended packages are few. The lesson is the layer view: a delete in its own layer saves nothing. If the base tag no longer exists, use a current supported `debian` slim tag.

10. **See a secret leak in history, then fix it.**

    ```bash
    mkdir -p ~/c3/secret && cd ~/c3/secret
    printf 'not-a-real-secret-123' > token.txt
    cat > Dockerfile.leak <<'DOCKER'
    # change: a supported Alpine release, see the official alpine image page
    ARG ALPINE_VERSION=3.20
    FROM alpine:${ALPINE_VERSION}
    ARG API_TOKEN
    ENV API_TOKEN_COPY=$API_TOKEN
    RUN echo "token length: ${#API_TOKEN}" || true
    DOCKER
    docker build -f Dockerfile.leak --build-arg API_TOKEN="$(cat token.txt)" -t c3-secret:leak .
    docker history --no-trunc c3-secret:leak | grep -c 'not-a-real-secret-123'
    docker image inspect c3-secret:leak --format '{{json .Config.Env}}'

    cat > Dockerfile.fixed <<'DOCKER'
    # syntax=docker/dockerfile:1
    # change: a supported Alpine release, see the official alpine image page
    ARG ALPINE_VERSION=3.20
    FROM alpine:${ALPINE_VERSION}
    RUN --mount=type=secret,id=api_token \
        wc -c < /run/secrets/api_token
    DOCKER
    docker build --no-cache --progress=plain -f Dockerfile.fixed --secret id=api_token,src=./token.txt -t c3-secret:ok .
    docker history --no-trunc c3-secret:ok | grep -c 'not-a-real-secret-123'
    ```

    Expected: for `leak`, the `grep -c` count is above 0 and `Config.Env` contains `API_TOKEN_COPY=not-a-real-secret-123`. For `ok`, the count is `0`, and the build prints the byte count (`21`).
    If you see something else: `ENV` always persists the value in the config, so that part is certain. Whether the `ARG` value also shows in `docker history` depends on your builder version, so the count may be 0 for the `ARG` itself even though the `ENV` copy leaks; that does not make `ARG` safe (it can appear in build metadata and logs). If the `ok` build says secrets need BuildKit, upgrade Docker or set `DOCKER_BUILDKIT=1`.

11. **Scan an image with Trivy, without giving it the Docker socket.** Mounting `/var/run/docker.sock` into a container gives it control of the host, so export the image to a tar file and scan that.

    ```bash
    cd ~/c3
    docker save c3-hello:2 -o hello.tar
    docker run --rm -v "$PWD:/work:ro" aquasec/trivy:<PINNED_VERSION>@sha256:<digest> \
      image --input /work/hello.tar --severity HIGH,CRITICAL
    echo "exit=$?"
    ```

    Expected: Trivy downloads its vulnerability database on the first run, then prints a summary such as `Total: N (HIGH: x, CRITICAL: y)` or no findings. The exit code is `0` by default, even with findings. Add `--exit-code 1` to make a finding fail the command, as a CI gate does.
    If you see something else: Replace the placeholder with a Trivy release you have checked, and pin it the same way in a pipeline; do not use `latest`. A download or rate-limit error means the database could not be fetched (check network access or use a mirror). The output format (table, columns) and database sources vary by Trivy version, so not verified. Never paste real finding output into a public place if it names your internal packages.

12. **Run the image hardened and watch a write fail.**

    ```bash
    docker run --rm \
      --user 10001:10001 --read-only --tmpfs /tmp \
      --cap-drop ALL --security-opt no-new-privileges \
      --memory 128m --cpus 0.5 --pids-limit 100 \
      --entrypoint sh c3-hello:2 -c 'echo ok > /tmp/x && echo "tmp write ok"; echo x > /etc/x; echo "exit=$?"'
    ```

    Expected: `tmp write ok`, then an error `can't create /etc/x: Read-only file system`, then `exit=1`.
    If you see something else: if `/etc/x` is created, `--read-only` was dropped (check the line continuations). If `/tmp` is not writable, you forgot `--tmpfs /tmp`. Next, start the normal service the same way (without the `--entrypoint` override) and confirm it still answers: an app that cannot run read-only usually needs a `--tmpfs` for a temp path.

13. **Optional: push to Artifact Registry.** Run the commands from the Artifact Registry section with your sandbox project, check `gcloud artifacts docker images list`, then delete the repository using the cleanup command in the cost callout.
    Expected: the list shows `hello` with the tag `1.0.0` and a digest.
    If you see something else: `permission denied` or `denied: Permission "artifactregistry.repositories.uploadArtifacts" denied` means your account lacks a writer role on the repository; ask for the narrowest fix (a writer role on that repository), not a project owner role. An authentication error means you skipped `gcloud auth configure-docker`.

14. **Clean up.**

    ```bash
    docker rm -f c3-run c3-shell c3-exec 2>/dev/null
    docker rmi c3-hello:1 c3-hello:2 c3-hello:single c3-hello:shell c3-hello:ctx \
      c3-size:bad c3-size:good c3-secret:leak c3-secret:ok 2>/dev/null
    rm -rf ~/c3
    docker image prune -f
    ```

    Expected: images and containers named `c3-` are gone; `docker images` no longer lists them.
    If you see something else: an image "is being used by a stopped container" means a `c3-` container still exists; remove it first.

## Common mistakes

- **`COPY . .` before installing dependencies.** Every edit re-downloads everything. Copy the manifest, install, then copy the source.
- **Using `latest` or an unpinned base.** Builds become unrepeatable and a base update can break you silently. Pin tags, and digests where it matters.
- **Running as root by default.** A bug in the app is then root inside the container. Add a numeric non-root `USER`.
- **Putting secrets in `ARG`, `ENV`, `COPY` or a `RUN` command.** They end up in layers, history or metadata. Use secret mounts at build time and runtime injection for the app.
- **Deleting files in a later layer to save space.** The bytes stay. Clean up in the same `RUN`, or use a multi-stage build.
- **Shell-form `CMD` and `ENTRYPOINT`.** The shell is PID 1 and eats signals. Use the JSON exec form.
- **Forgetting `.dockerignore`.** The context is slow to upload and may carry `.git` and `.env` into the image.
- **Trusting the scan result alone.** A clean scan today does not mean clean tomorrow. Re-scan stored images and rebuild on a schedule.
- **Mounting the Docker socket into a tool container.** That tool can control the host. Pass an exported tar, or use a rootless or remote scanner.

## Check your understanding

1. Why should `COPY . .` come after the step that installs dependencies?
2. Why do teams deploy by digest (or an immutable tag) and not by `latest`?
3. Why is `ARG` not a safe place for a secret, and what do you use instead?
4. What do you gain and lose by choosing a distroless final image?
5. A teammate deletes a 200 MB download in the last `RUN`, and the image is still 200 MB larger than needed. Why, and how do you fix it?
6. Which three runtime flags would you add first to harden a container that serves HTTP?

> [!question]- Answers
>
> 1. Docker reuses a cached step only if its inputs and all earlier steps are unchanged. The dependency list changes rarely and the source changes constantly. With the manifest copied and installed first, an edit invalidates only the later steps and the slow install stays cached.
> 2. A tag can be moved, so two hosts can pull different content under one name, and you cannot say what runs or roll back reliably. A digest identifies exact content, and an immutable release tag is only ever pushed once. Either makes a deploy reproducible and an incident traceable.
> 3. A build argument can be recorded in the image history or build metadata (and in CI logs), and it is easy to copy into an `ENV` by mistake. Use `RUN --mount=type=secret` for build-time secrets, which are not written to any layer, and inject runtime secrets from the orchestrator or a secret manager.
> 4. You gain a smaller attack surface (no shell, package manager or extra tools) and smaller size. You lose easy debugging (no `docker exec ... sh`), the ability to install packages at run time, and some convenience tools. Use a debug sidecar when you must look inside.
> 5. The download lives in an earlier layer, and the `rm` only adds a whiteout in a new layer. Download, use and delete in the same `RUN`, or build in an earlier stage and copy only the result to the final stage.
> 6. A non-root user (`--user` or `USER` in the image), a read-only root filesystem with a `--tmpfs` for temporary files (`--read-only --tmpfs /tmp`), and `--cap-drop ALL` plus `--security-opt no-new-privileges`. Memory, CPU and PID limits come next.

## Next steps

Next lesson: [[learn/container-storage-networking-and-compose|Containers 04: Volumes, networks and Docker Compose]]. Previous lesson: [[learn/running-and-debugging-containers|Containers 02: Running, inspecting and debugging containers]].

To go deeper:

- [[patterns/dockerfile-hardening]] is the team pattern for small, non-root, reproducible images with scanning and signing.
- [[patterns/artifact-promotion-artifactory]] shows how one image digest moves from dev to production without being rebuilt.
- [[patterns/automated-dependency-updates]] covers keeping pinned base images current.
- [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02: Your first pipeline in GitLab CI and Jenkins, artifacts and YAML pitfalls]] for building and pushing an image in a pipeline.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Docker documentation: "Dockerfile reference" (https://docs.docker.com/reference/dockerfile/), "Building best practices" (https://docs.docker.com/build/building/best-practices/), "Multi-stage builds" (https://docs.docker.com/build/building/multi-stage/), "Build secrets" (https://docs.docker.com/build/building/secrets/), "Cache" (https://docs.docker.com/build/cache/) and "Multi-platform builds" (https://docs.docker.com/build/building/multi-platform/). Not checked against a running engine for this page.
- Docker documentation: `docker buildx imagetools inspect` and `docker run` (https://docs.docker.com/reference/cli/docker/) for the runtime flags.
- OCI Image Specification and Distribution Specification (https://github.com/opencontainers/image-spec, https://github.com/opencontainers/distribution-spec) for tags, digests and image indexes.
- Google Cloud documentation: "Artifact Registry" quickstart for Docker, and Artifact Registry pricing (https://cloud.google.com/artifact-registry/docs). Prices and features were not verified.
- Trivy documentation (https://trivy.dev/) and Grype (https://github.com/anchore/grype); cosign (https://docs.sigstore.dev/). Output formats and flags were not verified.
- Not verified: base image tags (`golang`, `alpine`, `debian`), buildx flags, Trivy output format, and whether `ARG` values appear in history under your BuildKit version.
