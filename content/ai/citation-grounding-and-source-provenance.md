---
title: "Citation grounding and source provenance"
description: "Make every answer citation point to a versioned source span and distinguish retrieval evidence from generated claims."
type: guide
tags:
  - ai
  - reliability
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A citation is useful only if a reader can identify the exact evidence that was retrieved, determine which source version it came from, and verify the passage independently. A document-level link can be insufficient when a source changes, contains multiple contradictory sections, or requires a precise table row. This note expands on the citation behavior in [[rag-over-runbooks-for-on-call]] by treating provenance as data carried through ingestion, retrieval and response rendering.

## 01 Provenance model

Assign stable identifiers to the source system, source record, source revision, extraction artifact, chunk and derived index generation. Record the transformation activity that produced each artifact: connector version, parser configuration, redaction policy version, chunking version and embedding contract. Use source timestamps or revision tokens as supplied by the authoritative system; do not infer source publication time from ingestion time. Separate a source's canonical URL from an internal storage URI, and keep display titles derived from trusted metadata rather than generated text.

A useful provenance chain answers: what source entity was used; what activity transformed it; which software or agent performed that activity; what input versions and policies applied; and which index generation surfaced it. W3C PROV offers an interoperable vocabulary of entities, activities and agents, but this note does not require adopting its full ontology. The practical data model can be simpler as long as relationships are durable and auditable. Preserve page number, section anchor, line range or stable source offset where possible; when offsets move, keep revision-specific anchors.

## 02 Grounding response claims

Pass only selected, authorized evidence and its stable citation handles to generation. Ask the application to return a structured list of claims and evidence IDs if the model/provider supports constrained output, then validate that every referenced ID was actually supplied and remains authorized. Structural conformance does not prove that a citation supports a claim. Render source excerpts from stored canonical content only when permitted, and associate each displayed assertion with one or more relevant spans. Avoid presenting a source title as evidence for a fact that appears nowhere in the cited passage.

Design the interface to distinguish quoted text, paraphrase, and inference. If evidence is indirect, conflicting, stale or incomplete, communicate that limitation and prefer an abstention over inventing a citation. Multiple citations may support a synthesis; make the relation between claim and sources clear. Do not let the model fabricate URLs, page numbers, or document IDs. Use application-resolved targets, and check authorization again when a reader follows a citation.

## 03 Source version and trust

A retrieved source may be unofficial, superseded, draft, or authored by a different authority than the user assumes. Track source owner, status, effective date, supersession relation and trust tier where the source system provides them. Do not imply that the newest ingested copy is the authoritative policy. If duplicate sources disagree, show both with dates or route to a human owner; do not silently choose by semantic score. Ensure stale source notices are tied to known lifecycle signals rather than guessed from modification timestamps.

Citations are also a security boundary: a URL or title can contain unsafe markup, and the cited material itself can contain instructions. Escape rendered metadata, constrain link schemes and hosts, and keep retrieved text separate from system instructions. See [[redacting-sensitive-data-before-llm-calls]] for handling sensitive material before external processing; provenance does not make disclosure safe.

## 04 Verification and failure modes

Test citation integrity with known-answer cases: source span exists, the document version is expected, the URL opens the right record, the caller is allowed, and the span actually supports the claim. Test changes and deletions: a new revision should resolve to its own anchor, and a withdrawn source should not remain a valid answer citation. Keep citation-support assessment separate from answer fluency. Human review remains important for high-impact claims; automated entailment or judge scores are signals, not proof.

Common failures include citations pointing to the parent but not a passage; chunk IDs changing on each run; silently replacing old content under a stable URL; synthesizing claims unsupported by any cited text; stale ACLs at link time; and lost provenance when a reranker creates a transformed summary. Carry original evidence IDs through every transformation and never cite an internal summary as if it were the source. Track unresolved citations, unsupported claims and broken targets, using redacted identifiers in logs.

## 05 Review checklist

- Does each evidence unit have source identity, version, transformation lineage and a durable anchor?
- Are source status, owner, effective date and supersession metadata represented where available?
- Are output citations restricted to retrieved IDs, validated and re-authorized at render/open time?
- Can readers distinguish exact quotation, paraphrase, synthesis and uncertainty?
- Are conflicting, withdrawn, stale, inaccessible and unsupported evidence cases tested?
- Can the team reproduce which source revisions produced an answer without retaining unnecessary text?
- Do links escape unsafe metadata and avoid using model-generated destinations?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/): W3C Recommendation of 30 April 2013; defines a model for provenance concepts and relationships.
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs): OpenAI API guide (canonical page fetched live); schema adherence can constrain output shape but does not establish factual grounding.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud's RAG architecture index, last reviewed 2025-09-22; supports retrieval flow context, not a universal citation correctness guarantee.
