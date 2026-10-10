# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are the `vX.Y.Z` git tags created by the Release workflow.

## [Unreleased]

### Added

- Notes site built with a vendored Quartz v5: content for ADRs, platform patterns, tools and standards, Obsidian-compatible Markdown.
- Cloudflare Worker serving the static build with security headers, `robots.txt` handling and `/version.txt`; production at notes.szolotov.com and staging at stage.notes.szolotov.com.
- CI workflow: type check, build, link check, format check, deploy dry run, actionlint and zizmor, with the aggregate required check `CI OK`.
- Staging deployment on every push to `main`, with a guard against stale runs and a post-deploy smoke test.
- Manual Release workflow (version validation, CI gate, annotated tag, GitHub Release) and tag-only production deployment with environment approval, smoke test and automatic rollback.
- Dependabot configuration, CODEOWNERS and `scripts/smoke-test.sh`.
- Documentation: README, deployment guide and Obsidian guide.
