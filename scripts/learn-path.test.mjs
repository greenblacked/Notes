import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import GithubSlugger from "github-slugger"

const index = fs.readFileSync("content/learn/index.md", "utf8")
const path = JSON.parse(fs.readFileSync("local-plugins/note-meta/learn-path.json", "utf8"))
const nav = fs.readFileSync("local-plugins/note-meta/LearnNav.tsx", "utf8")

// The lesson order as the index page lists it: bullets under "## Stage N" headings, the ones after
// "**Going deeper:**" being optional until the next bold line or heading.
function parseIndex() {
  const stages = []
  let cur = null
  let deeper = false
  for (const line of index.split("\n")) {
    const heading = line.match(/^## (Stage .*)$/)
    if (heading) {
      cur = { title: heading[1], core: [], deeper: [] }
      stages.push(cur)
      deeper = false
      continue
    }
    if (/^## /.test(line)) cur = null
    if (!cur) continue
    if (line.startsWith("**Going deeper:**")) deeper = true
    else if (line.startsWith("**Homelab")) deeper = false
    else if (line.startsWith("- `")) {
      const m = line.match(/\[\[learn\/([^\]|#\\]+)/)
      if (m) (deeper ? cur.deeper : cur.core).push(m[1])
    }
  }
  return stages
}

const core = path.stages.flatMap((s) => s.core)
const deeper = path.stages.flatMap((s) => s.deeper)

test("learn-path.json matches the lesson order in the learning path index", () => {
  assert.deepEqual(path, { stages: parseIndex() })
})

test("43 core and 21 optional lessons, and the week map ends at 43", () => {
  assert.equal(path.stages.length, 12)
  assert.equal(core.length, 43)
  assert.equal(deeper.length, 21)
  const rows = [...index.matchAll(/^\| (\d+)\s+\| ([\d, ]+?)\s+\|/gm)]
  const last = rows
    .at(-1)[2]
    .split(",")
    .map((s) => s.trim())
    .at(-1)
  assert.equal(Number(last), 43)
})

test("every lesson file is listed exactly once and every listed slug has a file", () => {
  const files = fs
    .readdirSync("content/learn")
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => f.slice(0, -3))
  const listed = [...core, ...deeper]
  assert.equal(new Set(listed).size, listed.length, "a slug is listed twice")
  assert.deepEqual([...listed].sort(), [...files].sort())
})

test("stage anchors are unique", () => {
  const slugger = new GithubSlugger()
  const anchors = path.stages.map((s) => slugger.slug(s.title))
  assert.equal(new Set(anchors).size, anchors.length)
  assert.ok(anchors.includes("stage-7-google-cloud"))
})

test("the hand-written next and previous links of core lessons equal the generated chain", () => {
  const first = (text, label) => {
    const m = text.match(new RegExp(`${label}\\b[^\\[\\n]*\\[\\[learn/([^\\]|#\\\\]+)`))
    return m ? m[1] : undefined
  }
  core.forEach((slug, i) => {
    const text = fs.readFileSync(`content/learn/${slug}.md`, "utf8")
    const next = first(text, "Next (?:lesson|stage)")
    const prev = first(text, "Previous lesson")
    assert.equal(next, core[i + 1], `${slug}: next`)
    assert.equal(prev, core[i - 1], `${slug}: previous`)
  })
})

test("the stage list on the index links to every stage heading", () => {
  const list = index.match(/^- \[Stage [^\n]*$/gm) ?? []
  assert.equal(list.length, path.stages.length)
  const slugger = new GithubSlugger()
  path.stages.forEach((s, i) => {
    assert.equal(list[i], `- [${s.title}](#${slugger.slug(s.title)})`, s.title)
  })
})

test("the navigation styles use tokens only and are hidden in print", () => {
  assert.doesNotMatch(nav, /#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  assert.match(nav, /@media print/)
  assert.doesNotMatch(nav, /animation|transition/)
})
