import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeRepo } from "./git-test-repo.mjs"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/require-text-paths.sh",
)
const repo = makeRepo("text-paths-")
after(() => repo.cleanup())

repo.write("README.md", "readme\n")
repo.write("content/a.md", "a\n")
const root = repo.commit("root")

function pr(edit, { base = root } = {}) {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", root)
  repo.branch(`work-${Math.random().toString(36).slice(2)}`, root)
  edit()
  const head = repo.commit("work")
  return { base, head }
}

function run(env) {
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    cwd: repo.dir,
    env: { ...process.env, EVENT_NAME: "pull_request", ...env },
  })
  return { code: r.status, out: r.stdout + r.stderr }
}

test("a push event is not restricted and needs no git", () => {
  const { code, out } = run({
    EVENT_NAME: "push",
    HEAD_REF: "",
    PR_BASE: "",
    PR_HEAD: "",
    GIT_DIR: "/nonexistent",
  })
  assert.equal(code, 0, out)
  assert.match(out, /Not a text\/ pull request/)
})

test("a non-text branch is not restricted", () => {
  const { base, head } = pr(() => repo.write("README.md", "changed\n"))
  const { code, out } = run({ HEAD_REF: "feat/x", PR_BASE: base, PR_HEAD: head })
  assert.equal(code, 0, out)
  assert.match(out, /Not a text\/ pull request/)
})

test("a text branch that changes only notes passes", () => {
  const { base, head } = pr(() => repo.write("content/b.md", "b\n"))
  const { code, out } = run({ HEAD_REF: "text/fix-typo", PR_BASE: base, PR_HEAD: head })
  assert.equal(code, 0, out)
})

test("a text branch that touches package.json fails with guidance", () => {
  const { base, head } = pr(() => {
    repo.write("content/b.md", "b\n")
    repo.write("package.json", "{}\n")
  })
  const { code, out } = run({ HEAD_REF: "text/fix-typo", PR_BASE: base, PR_HEAD: head })
  assert.equal(code, 1)
  assert.match(out, /package\.json/)
  assert.match(out, /may change only notes under content\//)
})

test("a text branch name outside lower-case kebab fails", () => {
  const { base, head } = pr(() => repo.write("content/b.md", "b\n"))
  for (const ref of ["text/Bad_Name", "text/", "text/a--b", "text/a/b", "text/-a"]) {
    const { code } = run({ HEAD_REF: ref, PR_BASE: base, PR_HEAD: head })
    assert.equal(code, 1, ref)
  }
})

test("a text branch with an empty diff fails", () => {
  const { base, head } = pr(() => {})
  const { code, out } = run({ HEAD_REF: "text/nothing", PR_BASE: base, PR_HEAD: head })
  assert.equal(code, 1)
  assert.match(out, /changes nothing/)
})

test("non-hex SHAs fail", () => {
  const { base, head } = pr(() => repo.write("content/b.md", "b\n"))
  assert.equal(run({ HEAD_REF: "text/x", PR_BASE: "main", PR_HEAD: head }).code, 1)
  assert.equal(run({ HEAD_REF: "text/x", PR_BASE: base, PR_HEAD: "HEAD" }).code, 1)
})

test("the merge base is used: a base that moved on with other commits still passes", () => {
  const { head } = pr(() => repo.write("content/b.md", "b\n"))
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", root)
  repo.write("package.json", "{}\n")
  const movedBase = repo.commit("main moved on")
  // head is not rebased onto movedBase; a plain two-dot diff would list package.json.
  const { code, out } = run({ HEAD_REF: "text/ok", PR_BASE: movedBase, PR_HEAD: head })
  assert.equal(code, 0, out)
})
