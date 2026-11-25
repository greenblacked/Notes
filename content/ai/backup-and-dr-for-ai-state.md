---
title: Backup and disaster recovery for AI state
description: What AI systems hold that must survive a disaster (indexes, registry, prompts, gateway policy, evals, memory) and whether to back each up or rebuild it.
type: guide
tags:
  - ai
  - reliability
  - gcp
  - postgres
created: 2026-11-24
modified: 2026-11-25
draft: false
---

An AI feature has state in places a normal backup plan does not list. Some of it is derived and cheap to rebuild. Some is derived but impossible to rebuild once an upstream model is retired. Some is the only copy. This note sorts it, says which DR tier it inherits ([[disaster-recovery-tiers-rpo-rto]]), and adds the checks a restore needs beyond "the row count matches". Drills follow [[0051-backups-proven-by-quarterly-restore-drills]] and [[tool-estate-restore-drills]].

> [!info] Scope and verification
> No vendor documentation was checked for this note. Managed vector database snapshot features differ by product and change often; read your product's backup page. The SQL and the comparison script were not run.

## Inventory: back up or rebuild

| State                                 | Usually lives in                                                                           | Rebuild from                                                                | Decision                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Vector index                          | pgvector on Cloud SQL, or a managed vector DB                                              | Source documents plus chunking config plus the same embedding model version | Back up if the rebuild exceeds RTO, or if the embedding model could be retired ([[embedding-model-migration]]). Otherwise rebuild. |
| Source document snapshot              | GCS                                                                                        | Upstream systems, if they keep history                                      | Back up (versioned bucket, [[gcs-deleted-object-recovery]])                                                                        |
| Model weights and adapters            | Artifactory or GCS ([[model-artifacts-in-artifactory]])                                    | Nothing for fine-tunes; the provider for open weights (may vanish)          | Back up, with the digest manifest ([[remote-code-at-model-load-time]])                                                             |
| Model registry metadata               | Registry DB                                                                                | Nothing                                                                     | Back up ([[model-inventory-and-owner-registration]])                                                                               |
| Prompts and system instructions       | Git ([[prompt-templates-and-versioning]], [[system-instruction-lifecycle]])                | Git                                                                         | Git is the backup. Make sure the deployed version is a commit.                                                                     |
| Gateway and router policy             | Git plus gateway runtime ([[ai-gateway-architecture-and-policy]], [[model-router-policy]]) | Git                                                                         | Git for policy. Do not back up counters or rate-limit state.                                                                       |
| Eval and golden sets                  | GCS or Git ([[golden-dataset-management-for-llms]])                                        | Nothing                                                                     | Back up; they are the only way to prove a restore works.                                                                           |
| Agent memory and conversation history | DB                                                                                         | Nothing                                                                     | Back up under retention rules ([[agent-memory-retention-and-deletion]], [[data-retention-and-deletion-in-llm-systems]])            |
| Caches (prompt, retrieval, semantic)  | Redis or DB                                                                                | Regenerates                                                                 | Do not back up. Flush on restore ([[retrieval-cache-invalidation]]).                                                               |
| Provider API keys                     | Secret manager                                                                             | Provider console                                                            | The secret manager's own backup                                                                                                    |

## Record what built each index

A vector backup is useless without the model that made it. Store, next to every index generation:

- embedding model ID and version;
- dimensions;
- chunking config commit;
- source snapshot ID;
- build time.

See [[embedding-pipeline-idempotency-and-reprocessing]] and [[vector-index-capacity-and-lifecycle]].

```yaml title="index-generations/kb-2026-11-24.yaml"
index: kb
generation: 2026-11-24
embedding_model: text-embedding-example@v3 # change: the exact provider model ID and version
dimensions: 1024
chunking_config_commit: 3f2a9c1e5b7d4f6a8c0e2b4d6f8a0c2e4b6d8f0a
source_snapshot: gs://example-kb-snapshots/2026-11-24/
built_at: 2026-11-24T03:10:00Z
documents: 48211
chunks: 391044
```

## Restore checks for a vector index

After restoring (pgvector follows [[cloud-sql-point-in-time-recovery]]), run structural checks in SQL, then quality checks with golden queries.

```sql title="check-restored-index.sql"
-- Run on the restored copy and on production (or the last recorded values); compare.
SELECT count(*) AS chunks,
       count(DISTINCT document_id) AS documents,
       vector_dims(embedding) AS dims,
       embedding_model
FROM kb_chunks             -- change: your table
GROUP BY vector_dims(embedding), embedding_model;
```

One row is expected, with the model and dimensions from the generation record. More than one row means mixed generations.

For the golden-query comparison:

- Run the golden queries through the retrieval service against production and against the restored copy.
- Save the results as JSON Lines, one `{"query_id": ..., "doc_ids": [...]}` per line, in rank order.
- Compare with this script:

```python title="compare_retrieval.py"
#!/usr/bin/env python3
"""Compare top-k retrieval results from two runs of the same golden queries.

Usage: python3 -I compare_retrieval.py baseline.jsonl restored.jsonl 10 0.9
Exits 1 if mean overlap@k is below the threshold or a query is missing.
"""
import json
import sys


def load(path):
    results = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                row = json.loads(line)
                results[row["query_id"]] = row["doc_ids"]
    return results


def main(baseline_path, restored_path, k, threshold):
    baseline, restored = load(baseline_path), load(restored_path)
    missing = sorted(set(baseline) - set(restored))
    overlaps = []
    for qid, docs in baseline.items():
        if qid in restored and docs[:k]:
            overlaps.append(len(set(docs[:k]) & set(restored[qid][:k])) / len(docs[:k]))
    mean = sum(overlaps) / len(overlaps) if overlaps else 0.0
    print(f"queries={len(baseline)} missing={len(missing)} mean_overlap@{k}={mean:.3f}")
    for qid in missing:
        print(f"missing: {qid}")
    return 0 if not missing and mean >= threshold else 1


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit("usage: compare_retrieval.py baseline.jsonl restored.jsonl K THRESHOLD")
    sys.exit(main(sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])))
```

- Pick the threshold from two runs against production itself. Approximate indexes are not perfectly repeatable.
- Then measure retrieval quality with [[retrieval-evaluation-metrics-and-thresholds]].

## Deleted data must stay deleted

> [!warning] A restore can bring back data you were obliged to delete
> Restoring memory, conversation history or a vector index from before a deletion request resurrects that data. Keep a deletion ledger (subject or document IDs and dates) outside the backed-up store, and replay it against every restored copy before it serves traffic ([[data-deletion-and-crypto-shredding-gcp]]).

## Hosted models and providers

- Provider outages are failover, not restore: [[model-provider-failover-and-routing]] and [[model-provider-outage-runbook]].
- DR here means you can still call an equivalent model in the DR region ([[model-region-selection-and-data-residency]]) with the same prompts and policy from Git.
- If the embedding model is hosted, the DR region must offer the same model version, or the restored index is unusable for new queries.

## Drill

Add AI state to the quarterly drill list:

1. Restore the vector store and run both checks.
2. Restore the model registry and redeploy one model by digest.
3. Restore memory and replay the deletion ledger.
4. Record measured RPO and RTO with the record format in [[tool-estate-restore-drills]].

## Not verified

- pgvector `vector_dims()`.
- Managed vector database snapshot features.
- Whether hosted embedding models are available per region.
- Neither script was run.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Related

- [[tool-estate-restore-drills]]
- [[backup-architecture-gke-cloud-sql-gcs]]
- [[knowledge-freshness-and-invalidation]]
- [[ai-services-control-mapping]]

## Sources

No external page was read for this note on 2026-11-24; the decisions rest on the linked notes and ADR 0051.
