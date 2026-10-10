# Writing notes in Obsidian

The notes live in `content/` as plain Markdown with YAML frontmatter and wikilinks, so they work both in Obsidian and in Quartz.

## Option A: open `content/` as a vault (recommended)

1. Obsidian, "Open folder as vault", choose `content/` in this repository.
2. Settings, Files and links:
   - **Use [[Wikilinks]]**: on.
   - **New link format**: Shortest path when possible.
   - **Default location for new attachments**: a folder inside the vault, for example `attachments/` (or "In subfolder under current folder").
   - **Automatically update internal links**: on, so renames do not break links.
3. Create notes in the matching section (`adr/`, `patterns/`, `tools/`, `standards/`) and start from the template described in `content/standards`.
4. Commit through a branch and pull request as usual (see the README).

### What of `.obsidian/` is committed

Quartz ignores `.obsidian` (see `ignorePatterns` in `quartz.config.yaml`), so it never reaches the site. The repository `.gitignore` excludes the per-device state: `content/.obsidian/workspace*.json`, `cache`, `plugins/` (community plugin data can contain tokens) and `themes/`. Shared vault settings such as `app.json`, `appearance.json`, `core-plugins.json` and `hotkeys.json` may be committed. Re-apply the settings above if they are not yet in the repository.

Notes that must never be published go in a `private/` folder or a `templates/` folder; both are in Quartz's default ignore patterns.

## Option B: Quartz Syncer plugin (selective publishing)

[Quartz Syncer](https://github.com/saberzero1/quartz-syncer) is an Obsidian community plugin that publishes selected notes from a separate personal vault into a Quartz repository's `content` folder.

What I verified (from the plugin's README, 2.2.0 era):

- Notes are selected with a publish flag; sync is one-way (vault to repository) over Git/HTTPS. Desktop access tokens are stored with `electron.safeStorage`.
- It supports Quartz v5 fully (this repository vendors Quartz v5) and Quartz v4 for publishing only.
- It needs Obsidian 1.13.0 or later. `publish` adds notes, `sync` also deletes notes removed from the vault (requires `force`).

What I could not verify: the exact frontmatter key of the publish flag, the minimum GitHub token scopes, and the full settings UI. See the plugin documentation at <https://saberzero1.github.io/quartz-syncer-docs/> and confirm before relying on it.

Recommended setup with this repository's rules:

- `main` requires a pull request and the `CI OK` check, so a token that pushes straight to `main` will be rejected. Configure the plugin to push to a **separate branch** (it exposes a branch setting in its CLI, `git.branch`; check the settings UI) and open a pull request from it.
- Use a fine-grained personal access token limited to this repository with Contents: read and write, and nothing else. Do not give it permission to change workflows.
- Review the pull request like any other change: CI builds the site and checks links before merge.
- Syncer deletes only with `force`; keep that off for routine publishing.
