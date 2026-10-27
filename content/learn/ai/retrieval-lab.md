---
title: "AI 03: Build a tiny retrieval lab before adding a model"
description: "Run an offline Python retrieval baseline, test missing evidence and distinguish retrieval failures from answer failures."
type: guide
tags:
  - learning
  - ai
created: 2026-10-27
modified: 2026-10-27
draft: false
---

[[learn/index#AI practice track|Track overview]] · [[learn/ai/verified-troubleshooting|Previous: AI 02]] · [[learn/ai/evaluation-lab|Next: AI 04]]

> [!info] Level: junior-middle | Time: 2 h | Prerequisites: [[learn/python-for-ops|Python for ops]] and [[learn/ai/introduction|AI 01]] | Lab: Python 3, standard library only

## What you will learn

- Run a deterministic lexical retrieval baseline.
- Inspect source IDs, scores and ranking changes.
- Distinguish relevant passages from answerable questions.
- Separate retrieval failures from generation failures.

## Retrieval first

A knowledge assistant needs documents, selection of relevant passages, a bounded context and a source-supported answer. A vector database is one possible implementation detail. Start by measuring a small lexical baseline. The toy below uses unique token overlap, not embeddings, semantic search or a complete RAG system. It intentionally exposes a limitation: questions about restore tests and RTO can retrieve the same document even though only one has an answer.

## Hands-on exercises

1. Run this in a new terminal. It creates a private temporary workspace; record the printed path if you close the shell.

```bash
AI_LAB_DIR=$(mktemp -d)
export AI_LAB_DIR
printf '%s\n' "$AI_LAB_DIR"
cat > "$AI_LAB_DIR/retrieve.py" <<'PYCODE'
import json
import re
import sys

DOCS = {
    "backup": "Lantern backup runs daily. Restore tests run monthly.",
    "deploy": "Lantern deployment rollback uses the previous image digest.",
    "access": "Lantern access requires a named account and MFA.",
}
STOP = {"a", "an", "the", "is", "are", "what", "how", "does", "of", "and"}

def tokens(text):
    return set(re.findall(r"[a-z0-9]+", text.lower())) - STOP

def retrieve(query):
    q = tokens(query)
    ranked = sorted(
        ((len(q & tokens(text)), key, text) for key, text in DOCS.items()),
        key=lambda row: (-row[0], row[1]),
    )
    return [{"source": key, "score": score, "text": text}
            for score, key, text in ranked if score > 0][:2]

if __name__ == "__main__":
    print(json.dumps(retrieve(" ".join(sys.argv[1:])), indent=2))
PYCODE
python3 "$AI_LAB_DIR/retrieve.py" 'restore tests'
python3 "$AI_LAB_DIR/retrieve.py" 'recovery time objective'
python3 "$AI_LAB_DIR/retrieve.py" 'backup recovery time objective'
```

Expected: the first query returns `backup` with score 2; the second returns `[]`; the third returns `backup` with score 1 but still provides no RTO. These are expected outputs, not a claim of a model-backed lab run.

**If you see something else:** check Python 3, spelling and the unchanged fixture. A shell closed since setup loses `AI_LAB_DIR`; rerun setup to create a fresh workspace.

2. Add one document containing the word “restore” but no schedule. Repeat the first query and explain why a lexical hit is not evidence of answerability. Record ranking and source IDs before and after the change.
3. Optionally paste the returned passages into an approved assistant. Ask “What is the RTO?” and require either a source-supported answer or “not provided”. Expected: abstention even when `backup` was retrieved. No model or paid API is required to complete the retrieval exercise.
4. Write two independent failure labels: retrieval missed a relevant passage; generation contradicted or exceeded a retrieved passage. Explain which component you would change for each.

Clean up the lab file you created, then remove the empty directory:

```bash
rm -- "$AI_LAB_DIR/retrieve.py"
rmdir -- "$AI_LAB_DIR"
unset AI_LAB_DIR
```

If you added other files, inspect them before removing anything else. Do not substitute a recursive delete.

## Common mistakes

Calling token overlap semantic search; quoting a source ID without checking its text; treating a non-empty result as a supported answer; indexing private notes before deciding access and deletion rules.

## Check your understanding

1. Why can the backup document be retrieved without answering the RTO question?
2. How are equal-score results ordered?
3. Would embeddings recover an RTO absent from every source?
4. Which component failed if a relevant source was returned but the answer invented a schedule?

> [!question]- Answers
>
> 1. Its word overlap earns a score, but its text contains no RTO.
> 2. By source ID in ascending order, because the sort key uses negative score then source ID.
> 3. No. A better retriever cannot supply a missing fact; generation must abstain.
> 4. Generation or answer grounding failed; retrieval did return relevant evidence.

## Pass criteria

Reproduce all three cases, explain the false implication from a relevant hit and retain the ranking experiment. Continue into [[ai/hybrid-search-for-rag|hybrid search]] only after you have a baseline to compare.

## Next steps

[[learn/index#AI practice track|Track overview]] · [[learn/ai/verified-troubleshooting|Previous: AI 02]] · [[learn/ai/evaluation-lab|Next: AI 04]]

After completing the pass criteria, keep your evidence log and continue to [[ai/index|the production AI reference notes]] for the boundaries your next project needs.

## Sources

Concepts checked on 2026-10-27 against [NIST's Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) and [OWASP's prompt-injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). The exercises and grading criteria are this learning track's design. Model behaviour, privacy settings and account capabilities must be checked in the chosen tool. No model-backed runs or production validation are claimed here.
