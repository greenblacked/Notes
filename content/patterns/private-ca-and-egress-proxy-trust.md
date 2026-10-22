---
title: Private CA trust and egress proxies for containers, CI jobs and runtimes
description: Make OS stores, Java, Python, Node, Go and CI runners trust an internal CA and use an egress proxy correctly, without turning off TLS verification.
type: pattern
tags:
  - patterns
  - security
  - networking
  - docker
  - ci-cd
  - linux
created: 2026-10-21
modified: 2026-10-21
draft: false
---

An internal CA for Artifactory, a TLS-inspecting egress proxy, or a private GitLab with its own certificate: each breaks builds in a different way per language. `curl` works, `pip` fails, the Java build fails with a different error, and Node ignores the proxy altogether. The tempting fix is `-k`, `verify=False` or `GIT_SSL_NO_VERIFY`, and once it is in a shared template it never leaves. This note maps where trust and proxy settings live in each layer, gives one way to set them centrally, and a test job that proves they work.

> [!info] What was checked
> Read on 2026-10-21: the Node.js CLI and HTTP docs, the Go `crypto/x509` and `x/net/http/httpproxy` package docs, the curl and git documentation, the Requests and pip docs, the OpenJDK networking properties page, the Docker build-variable and proxy docs, the GitLab Runner self-signed certificates page, and the trust-manager README and `Bundle` CRD. `keytool`, `openssl s_client` and the Debian `update-ca-certificates` script were checked locally (OpenJDK 21, OpenSSL 3.0). **Not verified**: the RHEL-family `update-ca-trust` paths, SUSE and Alpine specifics beyond the GitLab Runner example, the JDK's default `cacerts` path and store password, whether OpenSSL-based tools other than curl honour `SSL_CERT_FILE` and `SSL_CERT_DIR` in your builds, npm, Maven and Gradle settings, curl's handling of a leading dot or `*.` in `NO_PROXY`, Python's `NO_PROXY` parsing, Google metadata and Private Google Access addresses for `NO_PROXY`, GitLab Runner Helm and Kubernetes executor CA mounting, Jenkins agent truststore setup, and the proxy-loop diagnosis, which is operational experience rather than documentation.

> [!warning] Never turn off verification
> `curl -k`, `git -c http.sslVerify=false`, `GIT_SSL_NO_VERIFY=true`, `verify=False` in Requests, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `pip --trusted-host` and their friends make the job accept any certificate, including an attacker's. GitLab's own docs call `GIT_SSL_NO_VERIFY` "temporary and insecure", and the Requests docs say `verify=False` leaves the application vulnerable. A CI job that downloads dependencies without verification is a supply-chain hole. Add the CA instead, as below, and block these flags in review ([[ci-pipeline-standard]]).

## Where trust lives

There is no single trust store. Each runtime either uses the operating system's bundle, ships its own, or both:

| Layer               | Default trust source                                                                                                             | How to add the private CA                                                                                                                                                                                | Status                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Debian, Ubuntu      | `/etc/ssl/certs/ca-certificates.crt`                                                                                             | PEM file with a `.crt` extension in `/usr/local/share/ca-certificates/`, then `update-ca-certificates` (`--fresh` rebuilds the links)                                                                    | Checked                           |
| Alpine              | Same command after `apk add ca-certificates`                                                                                     | Same directory and command, as in the GitLab Runner example                                                                                                                                              | Partly checked                    |
| RHEL, Rocky, Fedora | System trust managed by `update-ca-trust`                                                                                        | Commonly `/etc/pki/ca-trust/source/anchors/` then `update-ca-trust`                                                                                                                                      | Not verified                      |
| curl                | The bundle it was built with                                                                                                     | `--cacert FILE` or `CURL_CA_BUNDLE`                                                                                                                                                                      | Checked                           |
| git (HTTPS)         | curl's default                                                                                                                   | `git config http.sslCAInfo FILE` or `GIT_SSL_CAINFO`; `http.proxySSLCAInfo` for an HTTPS proxy                                                                                                           | Checked                           |
| Go (`crypto/x509`)  | The system pool                                                                                                                  | Usually nothing, once the OS bundle has the CA. `SSL_CERT_FILE` and `SSL_CERT_DIR` override the locations; on macOS and Windows the behaviour depends on the Go version                                  | Checked                           |
| Python Requests     | The `certifi` package's bundle, **not** the OS store                                                                             | `REQUESTS_CA_BUNDLE` (falls back to `CURL_CA_BUNDLE`), or `verify="/path/bundle.pem"`                                                                                                                    | Checked                           |
| pip                 | System stores via `truststore` by default from pip 24.2, on Python 3.10+ (the Python floor is not verified); otherwise `certifi` | `--cert` or `PIP_CERT` for an explicit bundle                                                                                                                                                            | Checked                           |
| Node.js             | Its bundled Mozilla CA list, **not** the OS store                                                                                | `NODE_EXTRA_CA_CERTS=/path/ca.pem` (read at process start only; ignored when code passes its own `ca`), or `--use-system-ca` (v23.8.0, Linux from v23.9.0) or `NODE_USE_SYSTEM_CA=1` (v24.6.0, v22.19.0) | Checked                           |
| Java (JVM)          | Its own `cacerts` keystore                                                                                                       | `keytool -importcert -cacerts ...`, or a separate truststore passed with system properties                                                                                                               | Flags checked, paths not verified |

Two traps stand out. Python Requests and Node.js both ignore the OS bundle by default, so "I added it to the image and curl works" proves nothing for them. And Java has a separate keystore, which on Debian may be regenerated from the OS store by a `ca-certificates` hook when the Java integration package is installed (observed on one Debian host, not verified as general behaviour).

## Proxy settings: who reads what

`HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` are a convention, not a standard. The Docker docs say so plainly and link GitLab's survey of the differences.

| Client                    | Reads the environment?                                                                                                               | Case rules                                                   | `NO_PROXY` matching                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| curl (and git over HTTPS) | Yes; `NO_PROXY` even overrides `--proxy`                                                                                             | Lower case wins; `http_proxy` is only read in lower case     | An entry matches that host and its subdomains (`example.com` matches `www.example.com`); `*` alone matches everything; CIDR since curl 7.86.0                     |
| Go `net/http`             | Yes, via `ProxyFromEnvironment`                                                                                                      | Lower case wins when both are set (per the `httpproxy` docs) | IP, CIDR, domain (matches itself and subdomains), leading `.` (subdomains only), optional port, `*`; loopback is never proxied; parse errors are ignored silently |
| Node.js                   | **Only** with `--use-env-proxy` (v24.5.0, v22.21.0) or `NODE_USE_ENV_PROXY=1` (v24.0.0, v22.21.0)                                    | Lower case wins                                              | `*`, exact host, `.example.com`, `*.example.com`, exact IP, IP range `a-b`, `host:port`; CIDR is not listed                                                       |
| Python Requests           | Yes by default                                                                                                                       | Not verified                                                 | Not verified                                                                                                                                                      |
| JVM                       | No: configured with system properties `http.proxyHost`, `http.proxyPort`, `https.proxyHost`, `https.proxyPort`, `http.nonProxyHosts` | n/a                                                          | `http.nonProxyHosts` is separated by `\|` with `*` wildcards, default `localhost\|127.*\|[::1]`, shared by HTTP and HTTPS                                         |
| Docker build              | Predefined build args `HTTP_PROXY`, `HTTPS_PROXY`, `FTP_PROXY`, `NO_PROXY`, `ALL_PROXY` (either case), no `ARG` needed               | n/a                                                          | Passed to the build's tools, which apply their own rules                                                                                                          |
| Docker CLI                | `proxies.default` in `~/.docker/config.json` (`httpProxy`, `httpsProxy`, `noProxy`) is injected into builds and containers           | n/a                                                          | As above                                                                                                                                                          |

Practical rules that survive all of these:

- **Set both cases to the same value**: `HTTPS_PROXY` and `https_proxy`, `NO_PROXY` and `no_proxy`.
- **Write `NO_PROXY` entries as plain domains** (`example.internal`, which curl and Go both treat as "this domain and its subdomains") **plus explicit CIDRs**, and know that Node will ignore the CIDRs. Do not rely on `*.` wildcards or a leading dot meaning the same thing everywhere.
- **Translate for Java**: the JVM needs its own system properties, typically via `JAVA_TOOL_OPTIONS` or the build tool's proxy settings.
- **Turn Node's proxy support on explicitly** where Node needs to reach the internet, or configure the HTTP client library the code uses.

### Entries you always need in Kubernetes

Without these, in-cluster calls go to the proxy, which cannot reach them:

```bash title="NO_PROXY for a Pod (fill in your ranges)"
# Replace with your cluster's Pod and Service ranges (from your cluster's Terraform or `gcloud container clusters describe`).
POD_CIDR="REPLACE_WITH_POD_RANGE"
SERVICE_CIDR="REPLACE_WITH_SERVICE_RANGE"
INTERNAL_DOMAIN="example.internal"   # your private DNS zone, if any

NO_PROXY="localhost,127.0.0.1,::1,kubernetes.default.svc,.svc,.cluster.local,svc,cluster.local,${POD_CIDR},${SERVICE_CIDR},${INTERNAL_DOMAIN}"
```

- `kubernetes.default.svc` is the in-cluster API server name, and Pod DNS search paths use `svc.cluster.local` and `cluster.local` (the cluster domain is configurable; check yours). Both the bare and the leading-dot forms are listed because clients disagree on what a leading dot means.
- Clients that call the API server by the `KUBERNETES_SERVICE_HOST` IP need the Service range.
- On GKE, the metadata server (used for Workload Identity tokens) and, with Private Google Access, the Google API endpoints must usually bypass the proxy too. Their names and addresses are on Google Cloud pages that were **not verified** here; take them from the GKE metadata server and Private Google Access docs, and see [[private-gke-and-controlled-egress]] for how egress is designed on this platform.

## Setting it once: golden base images

The most reliable place for trust is the base image, owned by the platform team ([[0040-golden-base-images-owned-by-platform]]). Every team image inherits it, and the CA is in place before any build step runs:

```dockerfile title="base/debian/Dockerfile (golden base, excerpt)"
FROM registry.example.com/upstream/debian:12@sha256:REPLACE_WITH_UPSTREAM_DIGEST

# Corporate root CA (public certificate only), committed next to this Dockerfile.
COPY certs/corp-root-ca.crt /usr/local/share/ca-certificates/corp-root-ca.crt

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && update-ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Point the runtimes that do not use the OS bundle at it.
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt \
    PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/corp-root-ca.crt
```

```dockerfile title="base/temurin/Dockerfile (JVM variant, excerpt)"
FROM registry.example.com/base/debian-jre:21@sha256:REPLACE_WITH_BASE_DIGEST
COPY certs/corp-root-ca.crt /tmp/corp-root-ca.crt
# "changeit" is the widely used default cacerts password; confirm it for your JDK build.
RUN keytool -importcert -noprompt -trustcacerts -cacerts \
      -alias corp-root-ca -file /tmp/corp-root-ca.crt -storepass changeit \
 && rm /tmp/corp-root-ca.crt
```

Rules:

- Only the **public** CA certificate goes into images. It is not a secret, but it identifies your internal PKI, so keep it in the private base-image repository, not in public ones.
- **Never set `HTTP_PROXY` or `HTTPS_PROXY` with `ENV` in a Dockerfile.** It is baked into the image config, follows the image into every environment, and may leak proxy credentials (the Docker docs warn that proxy settings in container config are plain text). Pass proxies at build time with `--build-arg` and at runtime from the environment.
- Docker's predefined proxy build args are kept out of the build cache and `docker history` unless the Dockerfile references them. Do not reference them.
- When the CA rotates, rebuild the base and every image on it; that is the cost of baking. Hardening rules are in [[dockerfile-hardening]] and [[dockerfile-standard]].

## Setting it at runtime: trust-manager

For images you do not build (vendor images, sidecars), distribute the bundle to the cluster with cert-manager's trust-manager. A `Bundle` (cluster-scoped, `trust.cert-manager.io/v1alpha1` on 2026-10-21) combines sources (`configMap`, `secret`, `inLine` or `useDefaultCAs`) and writes the result to a ConfigMap in selected namespaces:

```yaml title="bundle-corp-trust.yaml"
apiVersion: trust.cert-manager.io/v1alpha1
kind: Bundle
metadata:
  name: corp-trust
spec:
  sources:
    - useDefaultCAs: true # public roots; needs trust-manager installed with default CA support
    - configMap:
        name: corp-root-ca # holds the public corp root in key ca.crt, in trust-manager's trust namespace
        key: ca.crt
  target:
    configMap:
      key: bundle.pem
    namespaceSelector:
      matchLabels:
        trust.example.com/corp-ca: "true"
```

```yaml title="pod fragment: use the bundle"
spec:
  containers:
    - name: app
      env:
        - name: SSL_CERT_FILE
          value: /etc/corp-trust/bundle.pem
        - name: REQUESTS_CA_BUNDLE
          value: /etc/corp-trust/bundle.pem
        - name: NODE_EXTRA_CA_CERTS
          value: /etc/corp-trust/bundle.pem
      volumeMounts:
        - name: corp-trust
          mountPath: /etc/corp-trust
          readOnly: true
  volumes:
    - name: corp-trust
      configMap:
        name: corp-trust # trust-manager names the ConfigMap after the Bundle
```

Mount the ConfigMap as a directory, not with `subPath`, so updates reach running Pods (files from a `subPath` mount are not updated). Processes that read the bundle only at start, like Node, still need a restart. Which namespace trust-manager reads sources from, and the JKS or PKCS12 output for Java (`additionalFormats`), are in the trust-manager docs; check them for your version before relying on them.

## CI runners

### GitLab Runner

From the GitLab Runner self-signed certificate docs:

- **Runner to GitLab server:** the runner uses the system store, or `tls-ca-file` in the runner's section of `config.toml` (also accepted by `gitlab-runner register --tls-ca-file`), or a PEM file at `/etc/gitlab-runner/certs/<gitlab-hostname>.crt` when running as root. Restart the runner after changing it.
- **Git clone and artifacts in jobs:** the runner injects `CI_SERVER_TLS_CA_FILE` so the helper can build the chain. Your own scripts can use it too: `curl --cacert "$CI_SERVER_TLS_CA_FILE" ...`.
- **Everything else in the job** (package registries, Artifactory, external APIs) is the job image's responsibility. With the Docker executor, the docs mount the CA at `/etc/gitlab-runner/certs/ca.crt` and install it in a `pre_build_script`; that script runs before every job and breaks on images of another distribution. Golden images avoid the problem: the CA is already there.

Kubernetes executor and Helm chart settings for mounting the CA were **not verified**; see [[gitlab-runners-on-gke]] and [[ci-platform-gitlab-runners-and-jenkins-agents-on-gke]] for the runner setup, and set the proxy variables in the runner's job environment rather than in each `.gitlab-ci.yml`.

### Jenkins agents

Jenkins agents are JVMs: the agent's connection to the controller over TLS needs the CA in the agent JVM's truststore, which a golden JVM base image solves for both the agent container and Java build tools. Build tools inside the agent (Maven, Gradle, npm) each have their own proxy and trust settings (not verified here); prefer images where the OS bundle and `cacerts` already hold the CA, and pass proxies as environment and `JAVA_TOOL_OPTIONS`. Agent hardening is in [[jenkins-controller-and-agent-hardening]]. Dependency downloads should go through Artifactory remote repositories anyway ([[artifactory-remote-repo-caching-for-ci]]), which reduces the number of hosts that need the proxy to one.

## A trust and proxy test job

Run this in every golden base image's pipeline, and in a job image when a team reports TLS errors. It skips tools that are not installed.

```bash title="scripts/check-trust.sh"
#!/usr/bin/env bash
# Usage: check-trust.sh https://artifactory.example.internal/api/system/ping https://pypi.org/simple/
set -euo pipefail

BUNDLE="${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}"
fail=0

for url in "$@"; do
  host=$(printf '%s' "$url" | sed -E 's#^https://([^/:]+).*#\1#')
  echo "== $url"

  if command -v curl >/dev/null; then
    curl -sS -o /dev/null -w 'curl: HTTP %{http_code}\n' --max-time 15 "$url" || { echo "curl: FAILED"; fail=1; }
  fi

  if command -v openssl >/dev/null && [ -z "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
    # Direct connections only; through a proxy use: openssl s_client -proxy proxy-host:port ...
    if openssl s_client -connect "${host}:443" -servername "$host" -CAfile "$BUNDLE" \
         -verify_return_error </dev/null >/dev/null 2>&1; then
      echo "openssl: verified against $BUNDLE"
    else
      echo "openssl: FAILED"; fail=1
    fi
  fi

  if command -v python3 >/dev/null; then
    python3 -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=15); print("python urllib: ok")' "$url" \
      || { echo "python urllib: FAILED"; fail=1; }
    if python3 -c 'import requests' 2>/dev/null; then
      python3 -c 'import sys, requests; requests.get(sys.argv[1], timeout=15); print("python requests: ok")' "$url" \
        || { echo "python requests: FAILED"; fail=1; }
    fi
  fi

  if command -v node >/dev/null; then
    node -e 'require("https").get(process.argv[1], r => { console.log("node: HTTP " + r.statusCode); process.exit(0) })
               .on("error", e => { console.error("node: FAILED " + e.message); process.exit(1) })' "$url" \
      || fail=1
  fi

  if command -v git >/dev/null && [ "${CHECK_GIT_URL:-}" != "" ]; then
    git ls-remote "$CHECK_GIT_URL" >/dev/null && echo "git: ok" || { echo "git: FAILED"; fail=1; }
  fi
done

if command -v keytool >/dev/null; then
  keytool -list -cacerts -alias corp-root-ca -storepass changeit >/dev/null 2>&1 \
    && echo "java cacerts: corp-root-ca present" || { echo "java cacerts: corp-root-ca MISSING"; fail=1; }
fi

exit "$fail"
```

```yaml title=".gitlab-ci.yml (in the base image project)"
check-trust:
  stage: test
  image: ${CI_REGISTRY_IMAGE}/debian:${CI_COMMIT_SHA}
  script:
    - ./scripts/check-trust.sh "https://artifactory.example.internal/api/system/ping" "https://pypi.org/simple/"
```

Use one internal URL signed by the private CA and one public URL reached through the proxy. Note that `NODE_USE_ENV_PROXY=1` must be set for the Node check to use the proxy at all. The example hosts are placeholders for your own Artifactory and a public endpoint you are allowed to reach.

## Verify

```bash title="inspect the chain a server presents"
HOST=artifactory.example.internal
openssl s_client -connect "${HOST}:443" -servername "$HOST" -showcerts </dev/null \
  | openssl x509 -noout -subject -issuer -enddate
# Through the egress proxy (TLS inspection shows the proxy's issuer here):
openssl s_client -proxy proxy.example.internal:3128 -connect pypi.org:443 -servername pypi.org </dev/null \
  | openssl x509 -noout -issuer
```

- The issuer of the leaf certificate (or of the intermediate) must chain to the CA you installed. Behind a TLS-inspecting proxy, public sites show the proxy's issuing CA.
- `env | grep -i _proxy` in the job shows what the tools will see; check both cases.
- For Pods, `kubectl exec <pod> -- env | grep -i -E 'proxy|ssl_cert|ca_bundle|extra_ca'`.

## Troubleshooting

| Error                                                                                                                          | Meaning                                                                                                        | Likely fix                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSL certificate problem: unable to get local issuer certificate` (curl, git), `unable to get local issuer certificate` (Node) | The chain does not end at a CA the client trusts                                                               | Add the CA to the bundle that client reads (see the trust table); for Node set `NODE_EXTRA_CA_CERTS`.                                                       |
| `x509: certificate signed by unknown authority` (Go tools, GitLab Runner, Helm, kubectl)                                       | Same, for Go                                                                                                   | OS bundle in the image, or `SSL_CERT_FILE`; for the runner, `tls-ca-file`.                                                                                  |
| `PKIX path building failed ... unable to find valid certification path to requested target` (Java)                             | The JVM truststore lacks the CA                                                                                | Import into `cacerts` or pass a truststore; check that the build tool's JVM is the one you fixed.                                                           |
| `SSL: CERTIFICATE_VERIFY_FAILED` (Python)                                                                                      | Requests uses `certifi`, not the OS store, or a prepared-request flow ignored `REQUESTS_CA_BUNDLE`             | Set `REQUESTS_CA_BUNDLE`; for prepared requests, merge environment settings into the session as the Requests docs describe.                                 |
| Works for curl, Node times out reaching the internet                                                                           | Node ignores proxy variables by default                                                                        | `NODE_USE_ENV_PROXY=1` (supported versions) or configure the HTTP client.                                                                                   |
| Calls to other Services fail only after adding the proxy                                                                       | In-cluster names go to the proxy                                                                               | Add `.svc`, `.cluster.local`, the Service and Pod ranges to `NO_PROXY` (both cases).                                                                        |
| Requests hang or loop between proxy and target (operational experience, not documented)                                        | The proxy's own host is reached through itself, or an internal host is sent to the proxy, which routes it back | Put the proxy host and internal domains in `NO_PROXY`; test with `curl -v` to see which proxy is used.                                                      |
| Image pulls fail behind the proxy but Pods work                                                                                | Pulls are done by the node's container runtime, which does not read Pod environment                            | Node-level runtime proxy and registry mirrors are a node configuration; see [[gke-image-pull-registry-failures]] and [[artifactory-outage-cache-fallback]]. |

Wider network debugging (DNS, MTU, load balancers) is in [[network-troubleshooting-dns-mtu-tls-load-balancers]]; TLS basics are in [[http-and-tls]].

## Rollback

- **A bad CA file in the golden base** (wrong certificate, expired root): roll every affected image back to the previous base digest, which is why images pin bases by digest. Fix the base, then rebuild.
- **A bad `NO_PROXY` or proxy change in runner configuration**: revert the runner config change (Helm values or `config.toml`) and restart the runner; job definitions are unaffected.
- **A bad trust-manager `Bundle`**: revert the `Bundle` manifest; trust-manager rewrites the ConfigMaps. Pods that read the bundle only at start need a restart to pick up the fix.
- **Never "roll back" by disabling verification**, even for an hour.

## Related

- [[dockerfile-hardening]]
- [[gitlab-runners-on-gke]]
- [[artifactory-remote-repo-caching-for-ci]]
- [[private-gke-and-controlled-egress]]
- [[network-troubleshooting-dns-mtu-tls-load-balancers]]
- [[0040-golden-base-images-owned-by-platform]]
- [[tls-certificate-renewal]]
- [[cert-manager-vs-google-managed-certificates]]

## Sources

- [GitLab Runner: Self-signed certificates or custom CAs](https://docs.gitlab.com/runner/configuration/tls-self-signed/)
- [Node.js: Command-line options](https://nodejs.org/api/cli.html) (`NODE_EXTRA_CA_CERTS`, `--use-system-ca`, `--use-env-proxy`) and [HTTP: built-in proxy support](https://nodejs.org/api/http.html)
- [Go: crypto/x509](https://pkg.go.dev/crypto/x509) and [x/net/http/httpproxy](https://pkg.go.dev/golang.org/x/net/http/httpproxy)
- [curl man page](https://curl.se/docs/manpage.html) and [CURLOPT_NOPROXY](https://curl.se/libcurl/c/CURLOPT_NOPROXY.html)
- [git config: http.\*](https://git-scm.com/docs/git-config)
- [Requests: SSL certificate verification](https://requests.readthedocs.io/en/latest/user/advanced/) and [pip: HTTPS certificates](https://pip.pypa.io/en/stable/topics/https-certificates/)
- [JDK networking properties](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/doc-files/net-properties.html) and [keytool](https://docs.oracle.com/en/java/javase/21/docs/specs/man/keytool.html)
- [Docker: Build variables, proxy arguments](https://docs.docker.com/build/building/variables/#proxy-arguments) and [Docker CLI proxy configuration](https://docs.docker.com/engine/cli/proxy/)
- [cert-manager: trust-manager](https://cert-manager.io/docs/trust/trust-manager/)
- [GitLab blog: We need to talk: Can we standardize NO_PROXY?](https://about.gitlab.com/blog/2021/01/27/we-need-to-talk-no-proxy/)
