import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeRepo } from "./git-test-repo.mjs"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/require-content-only.sh",
)
const repo = makeRepo("content-only-")
after(() => repo.cleanup())

repo.write("README.md", "readme\n")
repo.write("quartz/old.ts", "export {}\n")
repo.write("content/a.md", "a\n")
repo.write("content/dir/b.md", "b\n")
repo.write("content/gone.md", "gone\n")
const base = repo.commit("base")

// Builds a commit on top of base with `edit`, returns the diff result from base to it.
function diffAfter(edit, env = {}) {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", base)
  edit()
  const head = repo.commit("change")
  const r = spawnSync("bash", [script, base, head], {
    encoding: "utf8",
    cwd: repo.dir,
    env: { ...process.env, ...env },
  })
  return { code: r.status, out: r.stdout + r.stderr, head }
}

test("added, changed, deleted and nested notes and raster images pass", () => {
  const { code, out } = diffAfter(() => {
    repo.write("content/new.md", "new\n")
    repo.write("content/a.md", "changed\n")
    repo.remove("content/gone.md")
    repo.write("content/dir/deep/c.md", "c\n")
    repo.write("content/img/pic.png", "png")
    repo.write("content/img/pic2.jpg", "jpg")
  })
  assert.equal(code, 0, out)
  assert.match(out, /^6 changed file/)
})

test("an empty diff passes with a count of 0", () => {
  const { code, out } = diffAfter(() => {})
  assert.equal(code, 0, out)
  assert.match(out, /\b0\b/)
})

test("LIST_FILE receives one status and path per line", () => {
  const list = join(repo.dir, "..", `list-${Math.random()}.tsv`)
  const { code, out } = diffAfter(
    () => {
      repo.write("content/new.md", "new\n")
      repo.write("content/a.md", "changed\n")
      repo.remove("content/gone.md")
    },
    { LIST_FILE: list },
  )
  assert.equal(code, 0, out)
  const lines = readFileSync(list, "utf8").trim().split("\n").sort()
  assert.deepEqual(lines, ["A\tcontent/new.md", "D\tcontent/gone.md", "M\tcontent/a.md"].sort())
})

test("a file outside content/ fails and is named", () => {
  for (const path of ["README.md", ".github/workflows/x.yml", "package.json", "worker/a.js"]) {
    const { code, out } = diffAfter(() => repo.write(path, "changed\n"))
    assert.equal(code, 1, path)
    assert.match(out, /::error::/, path)
    assert.ok(out.includes(path), path)
  }
})

test("a move from outside content/ into content/ names the old path", () => {
  const { code, out } = diffAfter(() => repo.move("quartz/old.ts", "content/old.md"))
  assert.equal(code, 1, out)
  assert.ok(out.includes("quartz/old.ts"), out)
})

test("a symlink, a gitlink and an executable inside content/ fail", () => {
  for (const [name, edit] of [
    ["symlink", () => repo.symlink("content/link.md", "../README.md")],
    ["gitlink", () => repo.gitlink("content/sub")],
    ["executable", () => repo.write("content/run.md", "x\n", 0o755)],
  ]) {
    const { code, out } = diffAfter(edit)
    assert.equal(code, 1, `${name}: ${out}`)
    assert.match(out, /::error::/, name)
  }
})

test("a type change of an existing note to a symlink fails", () => {
  const { code, out } = diffAfter(() => {
    repo.remove("content/a.md")
    repo.symlink("content/a.md", "../README.md")
  })
  assert.equal(code, 1, out)
})

test("active or unusual file names inside content/ fail", () => {
  for (const path of [
    "content/x.svg",
    "content/x.html",
    "content/x.js",
    "content/a b.md",
    "content/.hidden.md",
    "content/.dot/x.md",
    "content/x.md.exe",
    "Content/x.md",
    "content/x",
    "contentx/x.md",
  ]) {
    const { code, out } = diffAfter(() => repo.write(path, "x\n"))
    assert.equal(code, 1, `${path}: ${out}`)
  }
})

test("a path with a newline is reported with workflow-command escapes", () => {
  const { code, out } = diffAfter(() => repo.write("content/a\nb.md", "x\n"))
  assert.equal(code, 1)
  assert.match(out, /a%0Ab\.md/)
})

test("a bad ref exits 2", () => {
  const r = spawnSync("bash", [script, "nope", "HEAD"], { encoding: "utf8", cwd: repo.dir })
  assert.equal(r.status, 2)
  const none = spawnSync("bash", [script], { encoding: "utf8", cwd: repo.dir })
  assert.equal(none.status, 2)
})
