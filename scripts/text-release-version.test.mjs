import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/text-release-version.sh",
)
const C1 = "1".repeat(40)
const C2 = "2".repeat(40)
const TAGOBJ = "a".repeat(40)
const dir = mkdtempSync(join(tmpdir(), "text-version-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// FAKE_REFS: the tag list; FAKE_REF_OBJS: tag name -> ref object; FAKE_TAG_OBJS: tag object sha
// -> annotated tag object. The real --jq filters of the script run against them.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
if [[ "$2" == "--paginate" ]]; then shift; fi
case "$2" in
  */git/matching-refs/tags/v) printf '%s' "$FAKE_REFS" | jq -r "$4" ;;
  */git/ref/tags/*) jq -c --arg t "\${2##*/}" '.[$t]' <<<"$FAKE_REF_OBJS" | jq -r "$4" ;;
  */git/tags/*) jq -c --arg s "\${2##*/}" '.[$s]' <<<"$FAKE_TAG_OBJS" | jq -r "$4" ;;
  *) exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

const refs = (...tags) => tags.map((t) => ({ ref: `refs/tags/${t}` }))
const lightweight = (sha) => ({ object: { type: "commit", sha } })

function run({ tags, objs = {}, tagObjs = {}, env = {} }) {
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_REPO: "owner/repo",
      FAKE_REFS: JSON.stringify(refs(...tags)),
      FAKE_REF_OBJS: JSON.stringify(objs),
      FAKE_TAG_OBJS: JSON.stringify(tagObjs),
      ...env,
    },
  })
  return { code: r.status, out: r.stdout, err: r.stdout + r.stderr }
}

test("the next tag is the patch bump of the latest tag", () => {
  const a = run({ tags: ["v0.5.0", "v0.6.0"], objs: { "v0.6.0": lightweight(C1) } })
  assert.equal(a.code, 0, a.err)
  assert.equal(a.out, `latest=v0.6.0\nlatest_sha=${C1}\ntag=v0.6.1\nversion=0.6.1\n`)
  const b = run({ tags: ["v1.2.9", "v1.2.8"], objs: { "v1.2.9": lightweight(C2) } })
  assert.match(b.out, /^tag=v1\.2\.10$/m)
})

test("tags that are not plain releases are ignored", () => {
  const { code, out, err } = run({
    tags: ["v1.0.0-rc1", "v0.6.0", "vx", "v2.0"],
    objs: { "v0.6.0": lightweight(C1) },
  })
  assert.equal(code, 0, err)
  assert.match(out, /^latest=v0\.6\.0$/m)
})

test("an annotated tag is dereferenced to its commit", () => {
  const { code, out, err } = run({
    tags: ["v0.6.0"],
    objs: { "v0.6.0": { object: { type: "tag", sha: TAGOBJ } } },
    tagObjs: { [TAGOBJ]: { object: { sha: C2 } } },
  })
  assert.equal(code, 0, err)
  assert.match(out, new RegExp(`^latest_sha=${C2}$`, "m"))
})

test("no tag exits 3", () => {
  assert.equal(run({ tags: [] }).code, 3)
  assert.equal(run({ tags: ["v1.0.0-rc1"] }).code, 3)
})

test("a tag that does not resolve to a commit id fails", () => {
  const { code } = run({ tags: ["v0.6.0"], objs: { "v0.6.0": lightweight("nothex") } })
  assert.equal(code, 1)
})

test("EXPECT_LATEST must match the latest tag", () => {
  const base = { tags: ["v0.6.0"], objs: { "v0.6.0": lightweight(C1) } }
  assert.equal(run({ ...base, env: { EXPECT_LATEST: "v0.6.0" } }).code, 0)
  const stale = run({ ...base, env: { EXPECT_LATEST: "v0.5.0" } })
  assert.equal(stale.code, 1)
  assert.match(stale.err, /a release was created meanwhile/)
})
