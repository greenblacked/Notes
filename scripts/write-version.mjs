#!/usr/bin/env node
// Writes public/version.txt as "<version>+<sha>\n".
//   NOTES_VERSION  X.Y.Z without a leading "v" (default: "main")
//   NOTES_SHA      full 40-char commit SHA (fallback: GITHUB_SHA, then `git rev-parse HEAD`)
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outFile = join(root, "public", "version.txt")

function fail(message) {
  console.error(`write-version: ${message}`)
  process.exit(1)
}

const version = (process.env.NOTES_VERSION || "main").trim()
if (version !== "main" && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  fail(`NOTES_VERSION must be X.Y.Z without a "v" prefix (got "${version}")`)
}

let sha = (process.env.NOTES_SHA || process.env.GITHUB_SHA || "").trim()
if (!sha) {
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    fail("no NOTES_SHA/GITHUB_SHA and `git rev-parse HEAD` failed")
  }
}
if (!/^[0-9a-f]{40}$/.test(sha)) {
  fail(`commit SHA must be 40 lowercase hex characters (got "${sha}")`)
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${version}+${sha}\n`)
console.log(`write-version: public/version.txt = ${version}+${sha}`)
