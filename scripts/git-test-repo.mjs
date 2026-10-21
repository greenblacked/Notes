// Test helper: a throwaway git repository driven through the real git binary.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const identity = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
]

export function makeRepo(prefix = "git-repo-") {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const git = (...args) => {
    const r = spawnSync("git", [...identity, ...args], { cwd: dir, encoding: "utf8" })
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
    return r.stdout.trim()
  }
  git("init", "-q", "-b", "main")
  return {
    dir,
    git,
    write(path, text = "x\n", mode) {
      const full = join(dir, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, text, mode ? { mode } : undefined)
      git("add", "--", path)
    },
    symlink(path, target) {
      const full = join(dir, path)
      mkdirSync(dirname(full), { recursive: true })
      symlinkSync(target, full)
      git("add", "--", path)
    },
    gitlink(path, sha = "0123456789abcdef0123456789abcdef01234567") {
      git("update-index", "--add", "--cacheinfo", `160000,${sha},${path}`)
    },
    remove(path) {
      git("rm", "-q", "--", path)
    },
    move(from, to) {
      mkdirSync(dirname(join(dir, to)), { recursive: true })
      git("mv", from, to)
    },
    commit(message = "c") {
      git("commit", "-q", "--allow-empty", "-m", message)
      return git("rev-parse", "HEAD")
    },
    branch(name, from) {
      git("checkout", "-q", "-b", name, ...(from ? [from] : []))
    },
    checkout(name) {
      git("checkout", "-q", name)
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
