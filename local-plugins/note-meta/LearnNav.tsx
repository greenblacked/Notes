import { slug as headingSlug } from "github-slugger"
import type { FullSlug } from "../../quartz/util/path"
import { resolveRelative } from "../../quartz/util/path"
import type { QuartzPluginData } from "../../quartz/plugins/vfile"
import path from "./learn-path.json"

/**
 * Stage and lesson navigation for the pages under learn/ (not the index). The order lives in
 * learn-path.json, which a script test keeps equal to the lists on the learning path index.
 * A core lesson shows its stage, "Lesson k of 43" and the previous and next core lesson; a
 * going-deeper lesson shows "Optional lesson k of 10" and walks the optional chain.
 */
type Stage = { title: string; core: string[]; deeper: string[] }
const stages: Stage[] = path.stages

const chain = (key: "core" | "deeper") =>
  stages.flatMap((s) => s[key].map((slug) => ({ slug, stage: s })))
const core = chain("core")
const deeper = chain("deeper")

export function learnNav(slug: string, allFiles: QuartzPluginData[]) {
  const prefix = "learn/"
  if (!slug.startsWith(prefix) || slug === "learn/index") return null
  const lesson = slug.slice(prefix.length)
  const isCore = core.some((l) => l.slug === lesson)
  const list = isCore ? core : deeper
  const i = list.findIndex((l) => l.slug === lesson)
  if (i < 0) return null

  const here = slug as FullSlug
  const titleOf = (s: string) => {
    const t = allFiles.find((f) => f.slug === `${prefix}${s}`)?.frontmatter?.title
    return typeof t === "string" && t ? t : s
  }
  const href = (s: string) => resolveRelative(here, `${prefix}${s}` as FullSlug)
  const stage = list[i].stage
  const stageHref = `${resolveRelative(here, "learn/index" as FullSlug)}#${headingSlug(stage.title)}`
  const prev = list[i - 1]
  const next = list[i + 1]
  const step = (rel: "prev" | "next", label: string, target: { slug: string }) => (
    <li class={`learn-nav-${rel}`}>
      <a class="internal" rel={rel} href={href(target.slug)}>
        <span class="learn-nav-dir">{label}</span>
        <span class="learn-nav-title">{titleOf(target.slug)}</span>
      </a>
    </li>
  )

  return (
    <nav class="learn-nav" aria-label="Learning path">
      <p class="learn-nav-where">
        <span class="learn-nav-stage-line">
          {!isCore && "Going deeper, "}
          <a class="internal learn-nav-stage" href={stageHref}>
            {stage.title}
          </a>
        </span>
        <span class="learn-nav-pos">
          {isCore
            ? `Lesson ${i + 1} of ${list.length}`
            : `Optional lesson ${i + 1} of ${list.length}`}
        </span>
      </p>
      {(prev || next) && (
        <ul class="learn-nav-steps">
          {prev && step("prev", "Previous", prev)}
          {next && step("next", "Next", next)}
        </ul>
      )}
    </nav>
  )
}

export const learnNavCss = `
.learn-nav {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
  margin: 0.9rem 0 0.5rem;
  font-family: var(--ui);
  font-size: 0.875rem;
  line-height: 1.4;
}

.learn-nav p,
.learn-nav ul {
  margin: 0;
  padding: 0;
}

.learn-nav-where {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 1.25rem;
  min-width: 0;
  color: var(--darkgray);
  font-weight: 500;
}

.learn-nav-pos {
  color: var(--gray);
  font-variant-numeric: lining-nums tabular-nums;
}

.learn-nav-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 2rem;
  list-style: none;
}

.learn-nav-steps li {
  flex: 1 1 14rem;
  min-width: 0;
  margin: 0;
  padding: 0;
}

.learn-nav-steps li::before {
  content: none;
}

.learn-nav-dir {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--gray);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.learn-nav a {
  overflow-wrap: anywhere;
}

@media print {
  .learn-nav {
    display: none;
  }
}
`
