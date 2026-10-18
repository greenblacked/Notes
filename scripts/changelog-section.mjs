#!/usr/bin/env node
// Prints the body of the CHANGELOG section for a version (Node built-ins only).
//   node scripts/changelog-section.mjs <X.Y.Z> [path=CHANGELOG.md]
// Fails when the section is missing, duplicated or empty.
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

export function section(text, version) {
  if (!SEMVER.test(version)) throw new Error(`Version must be X.Y.Z, got '${version}'.`)
  const escaped = version.replace(/\./g, "\\.")
  const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`)
  const lines = text.split(/\r?\n/)
  const starts = []
  lines.forEach((line, i) => {
    if (heading.test(line)) starts.push(i)
  })
  if (starts.length === 0) throw new Error(`CHANGELOG.md has no section for ${version}.`)
  if (starts.length > 1) throw new Error(`CHANGELOG.md has a duplicate section for ${version}.`)
  let end = lines.length
  for (let i = starts[0] + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i
      break
    }
  }
  const body = lines.slice(starts[0] + 1, end)
  while (body.length && body[0].trim() === "") body.shift()
  while (body.length && body[body.length - 1].trim() === "") body.pop()
  if (!body.some((line) => line.startsWith("- "))) {
    throw new Error(`The CHANGELOG.md section for ${version} is empty.`)
  }
  return body.join("\n") + "\n"
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [version, path = "CHANGELOG.md", ...rest] = process.argv.slice(2)
  if (!version || rest.length > 0) {
    console.error("usage: node scripts/changelog-section.mjs <X.Y.Z> [path=CHANGELOG.md]")
    process.exit(2)
  }
  try {
    process.stdout.write(section(readFileSync(path, "utf8"), version))
  } catch (err) {
    console.error(`::error::${err.message}`)
    process.exit(1)
  }
}
