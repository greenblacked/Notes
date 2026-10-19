---
title: "Containers 05: Faster image builds: measure, order for cache, and use BuildKit cache and bind mounts"
description: Measure where image build time and size go, order steps for cache hits, and use BuildKit cache and bind mounts without leaking secrets.
type: guide
tags:
  - learning
  - docker
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

> [!info] Level: junior-middle | Time: about 3 h | You need: [[learn/building-and-shipping-images|Containers 03: Building and shipping images]] | Lab: Docker on the lab VM from [[learn/lab-setup|Start 01: Set up your lab]]

A build that takes eight minutes is not only annoying. It slows every pull request, hides real failures behind waiting, and makes people batch changes, which makes releases riskier. [[learn/building-and-shipping-images|Containers 03]] taught you to write a small, safe image and mentioned layer order and a registry cache. This lesson is about **speed and measurement**: finding where the time and the bytes go, keeping the cache valid, and using two BuildKit features, **cache mounts** and **bind mounts**, that Containers 03 did not cover.

> [!note] Nothing here was run for this page
> The commands follow the Docker documentation and are not verified. Timings and sizes are illustrative and labelled so. Compare them with your own output, and check the Docker and BuildKit documentation for your version.

## What you will learn

- How to measure a build: per-step time, `CACHED` lines, image size per layer and the size of the build cache.
- What invalidates the cache, and how to reorder a Dockerfile so that an edit to source code does not reinstall dependencies.
- How `RUN --mount=type=cache` keeps a package manager's download cache between builds without putting it in the image.
- How `RUN --mount=type=bind` reads files without adding a layer.
- Why a cache mount is local to one builder and is not a CI cache, and how to clean the build cache safely.

## Measure first

Optimising without numbers is guessing. Take a baseline before you change anything.

### Per-step time and cache hits

`--progress=plain` prints every step's output and timing instead of the compact view:

```bash title="a plain, uncollapsed build log"
docker build --progress=plain -t speed:base . 2>&1 | tee build-base.log
```

```text
#7 [3/6] COPY requirements.txt .
#7 CACHED

#8 [4/6] RUN pip install -r requirements.txt
#8 0.512 Collecting flask==3.0.3
...
#8 DONE 41.2s

#9 [5/6] COPY . .
#9 DONE 0.1s
```

_Illustrative._

`CACHED` means BuildKit reused the step. `DONE 41.2s` is the time a step really took. The slowest step, usually the dependency install, is where you start. Search the log with `grep -E 'DONE|CACHED' build-base.log`. To time a whole build for a before and after comparison use `time docker build ...`.

### Where the size goes

```bash title="layer sizes, newest first"
docker history --no-trunc --format 'table {{.Size}}\t{{.CreatedBy}}' speed:base
docker image inspect -f '{{.Size}}' speed:base
```

```text
SIZE      CREATED BY
12.3kB    COPY . . # buildkit
287MB     RUN /bin/sh -c pip install -r requirements.txt # buildkit
0B        WORKDIR /app
...
```

_Illustrative._

`docker history` lists one row per layer with the size it added and the instruction that made it (`--no-trunc` stops the command text being cut off; `--format` accepts a Go template, check `docker image history --help` for the fields). `docker image inspect -f '{{.Size}}'` gives the total in bytes, which is easy to record in CI. A fat `RUN` row is where to look. A later `RUN rm` never shrinks an earlier layer, as Containers 03 showed.

> [!tip] Optional: a layer explorer
> `dive` is a third-party tool that lets you browse layers and see wasted space. It is optional, it is not part of Docker, and you should install it only from its official project page and review its licence. Everything in this lesson works with the Docker CLI alone.

### How big is the build cache

The cache is disk space. See what BuildKit holds:

```bash title="build cache usage"
docker buildx du
docker buildx du --verbose | head -30
```

```text
ID                         RECLAIMABLE   SIZE      LAST ACCESSED
k2x...                     true          287MB     2 minutes ago
...
Reclaimable:   1.2GB
Total:         1.4GB
```

_Illustrative._

`RECLAIMABLE` entries are not in use by a running build. If a CI runner's disk fills up, this is one of the first places to look (`docker system df` gives a wider view that includes images and volumes).

## What breaks the cache

BuildKit reuses a step when the instruction and its inputs are the same, **and** every earlier step was reused. The first miss invalidates everything after it. The usual causes:

| Cause                             | Why it invalidates                                                                                  | What to do                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A changed file in `COPY` or `ADD` | The cache key includes the content (checksum) of the copied files, not just the instruction text.   | Copy only what the next step needs, and copy it late.                                  |
| A changed `ARG` or `ENV` value    | The value is part of the instruction's input for steps that use it, so a new value means a new key. | Avoid volatile values (build time, commit SHA) early in the file.                      |
| Instruction order                 | One changed step invalidates every step below it.                                                   | Put rarely changing steps first.                                                       |
| A changed base image              | A new digest for the `FROM` tag is a different parent.                                              | Pin by digest where you need reproducibility ([[learn/building-and-shipping-images]]). |
| `--no-cache`                      | Ignores all cached steps.                                                                           | Use it deliberately, for example in a scheduled "clean" build.                         |
| `--no-cache-filter=STAGE`         | Ignores the cache for the named stages only.                                                        | Rebuild just the stage that fetches things that change upstream.                       |

A classic trap: `RUN apt-get update && apt-get install -y curl` stays cached for months, so a security fix in the package index never arrives. The cache cannot know that the outside world changed. The answer is a periodic `--no-cache` or `--no-cache-filter` build, plus rebuilding when the base image is updated ([[patterns/automated-dependency-updates]]).

A second trap: putting `ARG BUILD_DATE` or a commit SHA near the top of the file. Every build then has a different input and nothing below it is ever cached. Declare it as late as possible, or use it only in a label in the last stage.

## Order for cache hits

The rule is: **least often changed first, most often changed last.** For almost every language that means the dependency manifest and lockfile, then the install, then the source:

```dockerfile title="Dockerfile (before): any source edit reinstalls dependencies"
# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
CMD ["python", "app.py"]
```

`COPY . .` changes whenever any file changes, so `pip install` runs every time. Reorder:

```dockerfile title="Dockerfile (after): reinstall only when requirements change"
# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "app.py"]
```

Now an edit to `app.py` invalidates only the last `COPY`; the install is `CACHED`. The same shape applies to `package.json` and `package-lock.json` before `npm ci`, `go.mod` and `go.sum` before `go mod download`, and `pom.xml` before a dependency fetch. Keep a `.dockerignore` so `COPY . .` does not pull in `.git` and build output (covered in Containers 03). Use `# syntax=docker/dockerfile:1` as the first line, as above; it selects the current stable Dockerfile frontend, which the mount syntax below needs. Pin an exact frontend version if you require bit-for-bit reproducibility.

Reordering helps when the manifest rarely changes. When it does change, the whole install re-runs from nothing, and a 40-second download of unchanged packages is wasted. That is the problem cache mounts solve.

## Cache mounts

`RUN --mount=type=cache,target=DIR` gives one `RUN` step a persistent directory that **survives between builds** on the same builder. The package manager's download cache lives there, so a changed manifest re-downloads only the packages that are new.

```dockerfile title="Dockerfile: pip with a cache mount"
# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt
COPY . .
CMD ["python", "app.py"]
```

Two facts matter:

- **The content of a cache mount is not in the image.** It lives outside the layers. The image has the installed packages (in `site-packages`), but not the wheel download cache. That keeps the image small, and it is why you should not run `pip install --no-cache-dir` here: you want the cache.
- **A cache mount is an optimisation, not a source of truth.** If it is empty or gone, the build must still succeed, only slower. Never put anything there that the build depends on for correctness.

The same idea for npm and for apt:

```dockerfile title="Dockerfile: npm with a cache mount"
# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
CMD ["node", "server.js"]
```

```dockerfile title="Dockerfile: apt with cache mounts"
# syntax=docker/dockerfile:1
FROM debian:bookworm-slim
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
 && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates
```

The apt example needs two details, which the Docker documentation shows for this case:

- **`sharing=locked`.** Two builds that run at the same time would otherwise write to the same apt directories and corrupt each other. `locked` makes the second wait for the first.
- **Remove the `docker-clean` config.** Debian-based images ship `/etc/apt/apt.conf.d/docker-clean`, which deletes downloaded packages after each install. With it in place the cache mount stays empty and gains nothing. The sample removes it and sets `Keep-Downloaded-Packages`. The exact lines and the mount targets can change between base image and Docker versions: check the current docs before you copy this.

> [!note] `sharing`, `id` and `uid`
> A cache mount has options: `id` (to share one cache between several `RUN` steps or stages), `sharing` (`shared` is the default, `private`, `locked`), `uid`, `gid` and `mode` (for a non-root build user), and `from`/`source` (to seed it from a stage). Check the `RUN --mount` reference for the current list.

The cache mount's key idea is the second sentence of the previous section: the cache is **kept on the builder**. A second developer's laptop, or a fresh CI runner, starts with an empty one.

## Bind mounts

`RUN --mount=type=bind` makes files from the build context (or from another stage) visible to **one** `RUN` step, **without** adding them to a layer. It is the right tool when a step needs a file only while it runs.

```dockerfile title="Dockerfile: use the lockfile without a COPY layer"
# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
CMD ["node", "server.js"]
```

The manifests are present while `npm ci` runs; they add no layer. The cache key for the step still depends on the content of the bound files, so a change to the lockfile re-runs the step, just like `COPY`. By default a bind mount is read-only. It is the neat way to take a built artefact from an earlier stage without copying the whole stage into the final image (`from=builder,source=/out,target=/in`).

A bind mount is not a way to ship files. Anything you need in the final image still needs `COPY`.

> [!note] Secret mounts
> For credentials that a build step needs, use `RUN --mount=type=secret`, never `ARG`, `ENV` or a bound file. It is covered in [[learn/building-and-shipping-images|Containers 03]] and is not repeated here. A cache mount can hold secrets by accident too (a package manager writing credentials into its cache directory), so keep authentication out of the directories you mount as caches.

## Cache mounts in CI

CI runners are often fresh, short-lived machines. A cache mount lives in the **local** BuildKit cache of one builder, so a new runner sees an empty cache: the first build is as slow as before.

It is also **not** the same as the registry cache. The registry cache (`--cache-from` and `--cache-to type=registry`) stores **layers** (the result of steps) in a registry so any runner can reuse a step whose inputs have not changed. Cache mounts keep **files inside one step**, such as downloaded packages, and are not exported by `--cache-to` in the same way. The two answer different questions:

| Question                                                    | Tool                                    |
| ----------------------------------------------------------- | --------------------------------------- |
| Can a step be skipped because nothing it depends on changed | Layer cache (local or registry)         |
| When a step must run, can it avoid re-downloading packages  | Cache mount, on a builder that persists |

The registry layer cache is covered in [[learn/building-and-shipping-images|Containers 03]] and in detail in [[patterns/buildkit-registry-cache-in-ci]]. For cache mounts to help in CI you need a runner or builder that persists between jobs (a long-lived builder, a shared BuildKit daemon or a runner with a persistent volume), and you must accept that two jobs may share it. How to run such runners on Kubernetes is in [[patterns/gitlab-runners-on-gke]]; the pipeline itself is in [[learn/first-pipeline-gitlab-ci-and-jenkins]]. Some CI systems can export and import a mount's contents in a build step; whether yours does, and how, is something to check in its documentation.

## Cleaning up

BuildKit keeps cache until you or its garbage collector remove it. To remove it by hand:

```bash title="prune the build cache"
docker buildx du                       # look first
docker builder prune                   # remove dangling build cache, asks to confirm
docker builder prune --filter 'until=168h'   # only older than 7 days
docker builder prune --all             # remove ALL build cache, including cache mounts
```

> [!danger] Pruning deletes the build cache, and that is not reversible
> `docker builder prune --all` removes all build cache, including cache mounts, and the next build is slow again. On a shared CI builder it slows everybody else's jobs too. Run `docker buildx du` first, prefer an age filter, and never prune a shared builder during working hours without telling the owners. It does not delete images, volumes or running containers. Check `docker builder prune --help` for the options in your version.

BuildKit also has automatic garbage collection with a size or age budget, configured in the daemon or builder settings (check the current docs for the exact keys). For a CI machine, a budget is better than a manual prune.

## Hands-on exercises

You need Docker on the lab VM. All times and sizes below are illustrative, because they depend on your network and disk.

1. **Create a tiny project and a baseline.**

   ```bash
   mkdir -p ~/c5 && cd ~/c5
   printf 'flask==3.0.3\nrequests==2.32.3\n' > requirements.txt
   printf 'print("hello")\n' > app.py
   printf '.git\n__pycache__\n' > .dockerignore
   cat > Dockerfile <<'EOF'
   # syntax=docker/dockerfile:1
   FROM python:3.12-slim
   WORKDIR /app
   COPY . .
   RUN pip install -r requirements.txt
   CMD ["python", "app.py"]
   EOF
   time docker build --progress=plain -t c5:base . 2>&1 | grep -E 'DONE|CACHED'
   ```

   Expected: every step `DONE`, with the `pip install` step the slowest (tens of seconds), and a `real` time of the same order.
   If you see something else: if the image `python:3.12-slim` is unavailable, use a current supported slim Python tag. A very fast install means your network or a proxy cache is quick; the relative differences below still apply.

2. **Show the cache being broken by an unrelated edit.**

   ```bash
   echo '# change' >> app.py
   time docker build --progress=plain -t c5:base . 2>&1 | grep -E 'DONE|CACHED'
   ```

   Expected: `COPY . .` is `DONE`, and `pip install` is `DONE` again with the same long time, even though the requirements did not change.
   If you see something else: if `pip install` is `CACHED`, the copied content was identical (check you appended to the file) or the builder used a different cache; re-run with `--no-cache` first, then repeat the edit.

3. **Reorder for cache hits.** Replace the Dockerfile with the "after" version from the ordering section (copy `requirements.txt`, install, then `COPY . .`). Build once, edit `app.py`, then build again:

   ```bash
   docker build -q -t c5:ordered . > /dev/null
   echo '# change two' >> app.py
   time docker build --progress=plain -t c5:ordered . 2>&1 | grep -E 'DONE|CACHED'
   ```

   Expected: the requirements `COPY` and `pip install` are `CACHED`; only the last `COPY` runs, in well under a second.
   If you see something else: if the install re-runs, check that `COPY requirements.txt .` comes before `COPY . .`, and that `requirements.txt` did not change.

4. **See what a changed requirement costs without a cache mount.**

   ```bash
   echo 'jinja2==3.1.4' >> requirements.txt
   time docker build --progress=plain -t c5:ordered . 2>&1 | grep -E 'DONE|CACHED'
   ```

   Expected: the whole install runs again, re-downloading Flask and Requests. Note the time as T1.
   If you see something else: if it is fast, pip may have used a layer or a local proxy cache; note the number anyway.

5. **Add a pip cache mount and compare.** Edit the `RUN` line to `RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt`. Build once to fill the cache, change requirements again, and build:

   ```bash
   docker build -q -t c5:mount . > /dev/null
   echo 'idna==3.7' >> requirements.txt
   time docker build --progress=plain -t c5:mount . 2>&1 | grep -E 'DONE|CACHED'
   ```

   Expected: the install step runs but is faster than T1, because the already downloaded wheels come from the mount; only the new package is fetched. Record it as T2.
   If you see something else: if T2 is about T1, check that the target is pip's real cache directory for that user (`pip cache dir` inside a container run), that you did not use `--no-cache-dir`, and that Docker uses BuildKit (`docker buildx version`).

6. **Prove the cache mount is not in the image.**

   ```bash
   docker run --rm c5:mount sh -c 'ls /root/.cache/pip 2>&1 | head -3'
   docker image inspect -f '{{.Size}}' c5:ordered c5:mount
   ```

   Expected: the directory does not exist (or is empty) in the image, and both sizes are close.
   If you see something else: if the mount image is much larger, you probably copied the cache into a layer by another step.

7. **Measure the layers and the cache.**

   ```bash
   docker history --no-trunc --format 'table {{.Size}}\t{{.CreatedBy}}' c5:mount | head
   docker buildx du
   ```

   Expected: the `RUN pip install` row is the large one, and `buildx du` lists reclaimable cache of a few hundred megabytes or less.
   If you see something else: `docker history` shows `<missing>` IDs for layers from the base image, which is normal.

8. **Use a bind mount.** Change the install to read the manifest without a separate `COPY`:

   ```dockerfile
   RUN --mount=type=bind,source=requirements.txt,target=requirements.txt \
       --mount=type=cache,target=/root/.cache/pip \
       pip install -r requirements.txt
   ```

   Remove the earlier `COPY requirements.txt .` line, build, and compare `docker history`.
   Expected: there is no layer for the requirements file; the install still works.
   If you see something else: "file not found" means the `source` path is relative to the build context, so check it and the `.dockerignore`.

9. **Prune carefully.**

   ```bash
   docker buildx du | tail -3
   docker builder prune --filter 'until=1h'
   docker buildx du | tail -3
   ```

   Expected: recent cache stays, older cache goes. Do not use `--all` unless you are fine losing the cache you just built.
   If you see something else: if nothing is removed, everything is newer than the filter, which is expected on a lab VM.

Clean up: `cd ~ && rm -rf ~/c5`, then `docker rmi c5:base c5:ordered c5:mount` and `docker builder prune` if you want the disk back.

## Common mistakes

- **Putting `COPY . .` before the install.** Why it bites: any source edit reinstalls every dependency. Fix: manifest and lockfile, install, then the source.
- **Using a volatile `ARG` early.** Why it bites: a build date or SHA near the top changes the key of everything below. Fix: declare it late or use it only in a label in the last stage.
- **Trusting the cache for `apt-get update`.** Why it bites: security updates never arrive. Fix: rebuild without cache on a schedule, and rebuild when the base updates.
- **Using `--no-cache-dir` together with a cache mount.** Why it bites: pip stops writing to the cache you mounted, so it stays empty. Fix: drop the flag when you mount pip's cache.
- **Mounting a cache for apt but leaving `docker-clean` in place.** Why it bites: the base image deletes the downloads, so the mount does nothing. Fix: remove that file as the Docker documentation shows, and use `sharing=locked`.
- **Expecting cache mounts to survive on a fresh CI runner.** Why it bites: they are local to one builder, so the first build on a new runner is slow. Fix: a persistent builder for the mounts, and the registry layer cache for step reuse.
- **Relying on a cache mount for correctness.** Why it bites: an empty or pruned cache then breaks the build. Fix: treat it as a speed-up only.
- **Writing credentials into a cached directory.** Why it bites: a package manager may store tokens in its cache. Fix: use a secret mount for authentication and keep it out of cache targets.
- **Running `docker builder prune --all` on a shared builder.** Why it bites: everyone's next build is slow, and it cannot be undone. Fix: `docker buildx du` first, then an age filter.
- **Optimising before measuring.** Why it bites: you speed up a step that took two seconds. Fix: `--progress=plain` and a baseline first.

## Check your understanding

1. In a build log, what do `CACHED` and `DONE 41.2s` tell you, and how do you find the slowest step?
2. Why does `COPY . .` before `RUN npm ci` make every build slow? How do you fix the order?
3. Is the content of a `--mount=type=cache` directory part of the image? What follows for how you write the step?
4. Why does the apt cache mount example use `sharing=locked`, and why remove `docker-clean`?
5. A teammate adds cache mounts and expects CI to speed up. The pipeline gets no faster. Give two likely reasons and the fix for each.
6. What is the difference between a cache mount and the registry cache?

> [!question]- Answers
>
> 1. `CACHED` means BuildKit reused the step; `DONE 41.2s` is a step that really ran and took 41.2 seconds. Build with `--progress=plain`, then `grep -E 'DONE|CACHED'` and look for the largest time. Start with that step.
> 2. `COPY . .` changes whenever any file changes, so the step after it is always a miss. Copy `package.json` and the lockfile first, run `npm ci`, and copy the source afterwards, so the install is reused until the lockfile changes.
> 3. No. A cache mount is kept outside the layers, so the image does not contain it. The step must work with an empty cache, because the mount is only a speed-up, and you should not use flags such as `pip --no-cache-dir` that bypass the cache.
> 4. Concurrent builds would corrupt the shared apt directories, so `sharing=locked` makes them take turns. The `docker-clean` file makes the Debian-based image delete downloaded packages after install, which leaves the mount empty, so you remove it. Check the current docs for the exact lines.
> 5. The CI runners are fresh, so the local mount is empty on each job: use a persistent builder or runner. Or the layer cache is not shared, so unchanged steps still re-run: add the registry cache from Containers 03. Also check that the manifest step does not change on every commit.
> 6. The registry (or layer) cache stores the results of whole steps so a step can be skipped. A cache mount stores files used inside a step that still has to run, such as downloaded packages, and lives on the builder that ran it.

## Next steps

Next lesson: continue with [[learn/container-storage-networking-and-compose|Containers 04: Volumes, networks and Docker Compose]] if you have not done it, then return to your pipeline in [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02]] and add the measurements to a build job. Previous lesson on how images and layers work: [[learn/containers-under-the-hood|Containers 01]].

To go deeper:

- [[patterns/buildkit-registry-cache-in-ci]] for sharing the layer cache between runners.
- [[patterns/dockerfile-hardening]] for non-root users, minimal bases and read-only filesystems.
- [[patterns/gitlab-runners-on-gke]] for runners with a persistent builder.
- [[learn/building-and-shipping-images]] for `.dockerignore`, multi-stage builds, secrets and scanning, which this lesson does not repeat.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Docker documentation, "Build cache" (https://docs.docker.com/build/cache/) and "Optimize cache usage in builds" (https://docs.docker.com/build/cache/optimize/), for what invalidates the cache, order, cache mounts and bind mounts.
- Docker documentation, Dockerfile reference, `RUN --mount` (https://docs.docker.com/reference/dockerfile/), for the `cache`, `bind` and `secret` types and their options.
- Docker documentation, `docker buildx du` (https://docs.docker.com/reference/cli/docker/buildx/du/) and `docker image history` (https://docs.docker.com/reference/cli/docker/image/history/).
- Not verified: every command output and timing on this page (illustrative), the exact apt cache mount lines and mount targets for your base image, the current option names for `RUN --mount`, and the garbage collection settings of your builder. Check the current docs.
