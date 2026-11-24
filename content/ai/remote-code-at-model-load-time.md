---
title: Remote code at model load time
description: How a model artifact runs code when it is loaded (trust_remote_code, auto_map, pickle weights, custom ops) and how to load models with no code path.
type: guide
tags:
  - ai
  - security
  - supply-chain
  - kubernetes
created: 2026-11-24
modified: 2026-11-24
draft: false
aliases:
  - trust_remote_code
---

Loading a model is not always just reading numbers. A repository can ship Python modelling code that the loader imports. Pickle-based weight files can run code when they are deserialised. Compiled extensions run native code. Each of these makes "download a model" mean "run someone else's program inside the serving process, with its credentials and network". This note lists those paths, shows how to load with all of them closed, and shows what to do when a model really needs custom code. It complements [[model-supply-chain-verification]], which decides whether an artifact is the one you approved. This note decides whether loading it can execute anything.

> [!info] Scope and verification
> Checked on 2026-11-24 against the Transformers and PyTorch documentation and the huggingface_hub environment-variable reference (see Sources). The vLLM flags, the `use_safetensors` argument and the scanning script were not run or confirmed. See Not verified.

## How a model artifact runs code

| Path                          | What triggers it                                                                                                                     | Closed by                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Repository modelling code     | `trust_remote_code=True` plus an `auto_map` entry in `config.json` or `tokenizer_config.json` that points at `.py` files in the repo | `trust_remote_code=False`, which is the default. Never pass the flag from a config value that someone else controls. |
| Pickle weights                | `.bin`, `.pt`, `.pth`, `.ckpt` or `.pkl` files. Unpickling can run arbitrary code.                                                   | Accept only safetensors, or set `weights_only=True` explicitly.                                                      |
| Native extensions, custom ops | `.so`, `.pyd` or `.dylib` files in the repo, or kernels a runtime fetches at load                                                    | Refuse binaries in model repos and run offline.                                                                      |
| Load-time downloads           | A loader that resolves a branch name fetches whatever the branch points at today, including new code                                 | Pin a full commit SHA, serve from a promoted local copy and set `HF_HUB_OFFLINE=1`.                                  |

The Transformers documentation says: "Take extra precaution when loading a custom model. While the Hub includes malware scanning for every repository, you should still be careful to avoid inadvertently executing malicious code." It also shows loading "from a specific revision" with `revision=<commit hash>` "to avoid loading model code that may have changed".

For PyTorch, the serialization notes say that from version 2.6 `torch.load` uses `weights_only=True` when no `pickle_module` is passed, and that `weights_only=False` "can result in arbitrary code execution". Do it only for a file from a trusted source.

## Default: load with no code path

- Promote the model through quarantine into a local or registry copy, as in [[model-artifacts-in-artifactory]].
- The serving process loads only from that path, offline, with safetensors only.
- The serving process holds no Hub token. `HF_TOKEN` and the token stored under `HF_HOME` must not exist in the serving image or pod.

```python title="load_model.py"
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_DIR = "/models/example-model"  # change: the promoted, digest-checked copy

tokenizer = AutoTokenizer.from_pretrained(
    MODEL_DIR, trust_remote_code=False, local_files_only=True
)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_DIR,
    trust_remote_code=False,  # the default, stated so a reviewer sees it
    local_files_only=True,    # never reach the Hub at load time
    use_safetensors=True,     # refuse pickle weights
)
```

For code that calls `torch.load` directly:

```python title="load_checkpoint.py"
import torch

state = torch.load("/models/example-model/adapter.pt", weights_only=True)
```

## Check a model before promotion

- Run this in the quarantine job described in [[model-supply-chain-verification]].
- That job has no cloud or registry write credentials and no network beyond the fetch.
- The script uses only the Python standard library, so nothing from the model repo is imported.
- Run it with `python3 -I`.

```python title="check_model_dir.py"
#!/usr/bin/env python3
"""Fail if a downloaded model directory could run code at load time.

Usage: python3 -I check_model_dir.py /quarantine/example-model > manifest.json
Exit 0 with a SHA-256 manifest on stdout, or 1 with the problems on stderr.
"""
import hashlib
import json
import pathlib
import sys

CODE_SUFFIXES = {".py", ".so", ".pyd", ".dylib", ".dll"}
PICKLE_SUFFIXES = {".bin", ".pt", ".pth", ".ckpt", ".pkl", ".pickle"}
SKIP_PREFIXES = (".git/", ".cache/")


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main(root: pathlib.Path) -> int:
    problems, manifest = [], {}
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(SKIP_PREFIXES):
            continue
        suffix = path.suffix.lower()
        if suffix in CODE_SUFFIXES:
            problems.append(f"executable code in the repository: {rel}")
        if suffix in PICKLE_SUFFIXES:
            problems.append(f"pickle-based weights, use safetensors: {rel}")
        if suffix == ".json":
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                problems.append(f"unreadable JSON {rel}: {exc}")
                continue
            if isinstance(data, dict) and "auto_map" in data:
                problems.append(f"{rel} maps classes to repository code: {data['auto_map']}")
        manifest[rel] = sha256(path)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    json.dump(manifest, sys.stdout, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2 or not pathlib.Path(sys.argv[1]).is_dir():
        sys.exit("usage: check_model_dir.py <model-dir>")
    sys.exit(main(pathlib.Path(sys.argv[1])))
```

The manifest becomes the approved digest list that [[model-supply-chain-verification]] binds to the review decision.

## Serving offline on GKE

- The pod gets the promoted model as a read-only volume, no Hub token, offline mode and no egress.
- Do not pass `--trust-remote-code` to the server.
- Pin the image by digest.

```yaml title="model-server.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: model-server
  namespace: inference # change: your serving namespace
spec:
  replicas: 1
  selector:
    matchLabels:
      app: model-server
  template:
    metadata:
      labels:
        app: model-server
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: server
          image: vllm/vllm-openai:<tested-version>@sha256:<digest> # pin to a tested tag and digest
          args:
            - --model
            - /models/example-model # change: the promoted copy; never a Hub repo ID
            # Do not add --trust-remote-code. A model that needs it goes through the review below.
          env:
            - name: HF_HUB_OFFLINE
              value: "1"
            - name: HF_HOME
              value: /tmp/hf # writable scratch; holds no token
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            limits:
              nvidia.com/gpu: 1
          volumeMounts:
            - name: model
              mountPath: /models
              readOnly: true
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: model
          persistentVolumeClaim:
            claimName: example-model-v1 # change: PVC pre-filled from the promoted artifact
            readOnly: true
        - name: tmp
          emptyDir: {}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: model-server-no-egress
  namespace: inference
spec:
  podSelector:
    matchLabels:
      app: model-server
  policyTypes:
    - Egress
  egress: [] # no egress at all: the model is local and offline mode is on
```

- Clients still reach the pod. Add the ingress policy from [[kubernetes-network-policies]].
- Some servers write compile caches outside `/tmp`. If start-up fails on a read-only path, add an `emptyDir` for that path. Do not drop `readOnlyRootFilesystem`.
- GPU scheduling is covered in [[self-hosted-llm-inference-on-gke]].

## When a model needs custom code

1. Prefer a version of the architecture that Transformers or your server supports natively. Many architectures get native support after release; check before accepting custom code.
2. If you must use the custom code:
   - Copy the `.py` files from the pinned commit into your own repository.
   - Review them like any third-party dependency: imports, network calls, `subprocess`, `eval` or `exec`, file writes outside the cache.
   - Record the upstream SHA.
3. Load with `trust_remote_code=True` and `revision=<full 40-character SHA>`, or from the vendored copy. Never from a branch.
4. Run it in the same no-egress, no-token pod. The code then executes with no credentials to steal and nowhere to send anything. See [[code-execution-agent-sandboxing]] for the isolation model.
5. Record the exception in [[policy-exception-and-waiver-process]] with an expiry.

> [!warning] A flag in config is a remote code switch
> Exposing `trust_remote_code` or `--trust-remote-code` as a Helm value or environment variable lets anyone who can change that value run code in the serving pod. Hard-code it to false, and gate the exception path behind review.

## Workstations

The same rules apply to engineers pulling models locally. Their laptop holds Git and cloud credentials. See [[local-models-on-engineer-workstations]] and [[open-weight-model-risk-assessment]].

## Validation

- `check_model_dir.py` exits 0 on the promoted directory.
- `grep -rn -- "--trust-remote-code\|trust_remote_code=True" <deploy repo>` returns nothing outside approved exceptions.
- From a debug pod using the server's labels, outbound HTTPS fails.
- Run `kubectl exec` into the server and `env | grep -c HF_TOKEN`. The output is `0`.

## Rollback

- These are load-time settings. Rolling back means redeploying the previous approved digest and manifest; see [[model-version-pinning-and-upgrade-evals]].
- Do not re-enable remote code or online mode to get out of an outage.

## Not verified

- vLLM argument names (`--model`, `--trust-remote-code`) and whether the current image needs extra writable paths. The engine-args page was reached but its flag text was not read.
- `use_safetensors` and `local_files_only` on `from_pretrained`.
- Whether `TRANSFORMERS_OFFLINE` is still honoured. Only `HF_HUB_OFFLINE` was read.
- Whether `tokenizer_config.json`, `processor_config.json` or other files use keys other than `auto_map` to reference code.
- How kernel-download libraries behave at load.
- The script was not run.

## Related

- [[model-supply-chain-verification]]
- [[model-artifacts-in-artifactory]]
- [[open-weight-model-risk-assessment]]
- [[self-hosted-llm-inference-on-gke]]
- [[code-execution-agent-sandboxing]]
- [[agent-network-egress-controls]]
- [[backup-and-dr-for-ai-state]]

## Sources

- [Transformers, custom models](https://huggingface.co/docs/transformers/v5.13.1/models): the extra-precaution warning, `trust_remote_code=True` for custom models and loading from a specific revision. Read 2026-11-24.
- [Transformers, customizing models](https://huggingface.co/docs/transformers/v5.13.1/custom_models): the `auto_map` block in `config.json` that maps Auto classes to repo code. Read 2026-11-24.
- [PyTorch serialization notes](https://docs.pytorch.org/docs/main/notes/serialization.html): the `weights_only` default from 2.6 and the arbitrary code execution warning. Read 2026-11-24.
- [huggingface_hub environment variables](https://huggingface.co/docs/huggingface_hub/v1.1.1/en/package_reference/environment_variables): `HF_HUB_OFFLINE`, `HF_HOME`, `HF_HUB_CACHE` and `HF_TOKEN`. Read 2026-11-24.
