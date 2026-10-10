# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions are the `vX.Y.Z` tags created by the Release workflow.

## [Unreleased]

### Added

- Notes site built with Astro Starlight: Obsidian-style wikilinks and callouts,
  Mermaid, search, tags, and content for ADRs, patterns, tools and standards.
- Cloudflare Workers static assets hosting: production at notes.szolotov.com,
  stage at stage.notes.szolotov.com (noindex), with security headers and a
  hash-based Content-Security-Policy generated at build time.
- CI: unit tests, type check, strict builds with wikilink and built-site link
  checks, deploy dry runs, actionlint, shellcheck and zizmor, behind one
  required `CI OK` check.
- Stage deployment on every merge to `main`, skipped when a newer commit has
  landed, with a smoke test and automatic rollback.
- Release workflow (version ordering, green-CI gate, annotated tag, GitHub
  Release) and tag-only production deployment behind environment approval,
  with a smoke test and automatic rollback.
- Dependabot with cooldowns, CODEOWNERS, editor and Git attribute settings.
