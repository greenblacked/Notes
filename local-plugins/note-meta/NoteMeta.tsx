import readingTime from "reading-time"
import { classNames } from "../../quartz/util/lang"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"

const TYPE_LABELS: Record<string, string> = {
  adr: "ADR",
  pattern: "Pattern",
  tool: "Tool",
  standard: "Standard",
  runbook: "Runbook",
  note: "Note",
}

/** Chip colour class per status. Anything else gets the neutral style. */
const STATUS_TONES: Record<string, "accepted" | "proposed" | "warning"> = {
  accepted: "accepted",
  proposed: "proposed",
  deprecated: "warning",
  superseded: "warning",
  rejected: "warning",
}

interface DateParts {
  year: string
  month: string
  day: string
}

/**
 * YAML turns an unquoted `2026-10-11` into a Date (midnight UTC), while a quoted one stays a
 * string. Accept both and read the calendar day without a time zone shift.
 */
function dateParts(value: unknown): DateParts | undefined {
  let iso: string | undefined
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined
    iso = value.toISOString().slice(0, 10)
  } else if (typeof value === "string") {
    iso = value.trim()
  }
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!m) return undefined
  // Reject impossible dates such as 2026-13-45 or 2026-02-30 instead of showing them as written.
  const check = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (check.getUTCMonth() !== Number(m[2]) - 1 || check.getUTCDate() !== Number(m[3])) {
    return undefined
  }
  return { year: m[1], month: m[2], day: m[3] }
}

const asLowerString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : undefined

/**
 * Metadata strip above the title, driven by the frontmatter fields `type`, `status`, `verified`
 * and `decided` (see content/standards/writing-notes.md). Renders nothing when none is set, so
 * the home page, section indexes and the tags page stay clean. Reading time lives here too, so
 * the content-meta plugin is configured without it.
 */
export default (() => {
  const NoteMeta: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
    const fm = (fileData.frontmatter ?? {}) as Record<string, unknown>
    const type = asLowerString(fm.type)
    const status = asLowerString(fm.status)
    const verified = dateParts(fm.verified)
    const decided = dateParts(fm.decided)

    if (!type && !status && !verified && !decided) return null

    const text = typeof fileData.text === "string" ? fileData.text : ""
    const minutes = text ? Math.max(1, Math.ceil(readingTime(text).minutes)) : undefined

    return (
      <div class={classNames(displayClass, "note-meta")}>
        {type && (
          <span class="chip chip-type" data-type={type}>
            {TYPE_LABELS[type] ?? type}
          </span>
        )}
        {status && (
          <span class="chip chip-status" data-tone={STATUS_TONES[status] ?? "neutral"}>
            {status}
          </span>
        )}
        {decided && (
          <span class="note-meta-item">
            decided{" "}
            <time datetime={`${decided.year}-${decided.month}-${decided.day}`}>
              {`${decided.year}-${decided.month}-${decided.day}`}
            </time>
          </span>
        )}
        {verified && (
          <span class="note-meta-item">
            verified{" "}
            <time datetime={`${verified.year}-${verified.month}`}>
              {`${verified.year}-${verified.month}`}
            </time>
          </span>
        )}
        {minutes !== undefined && <span class="note-meta-item">{minutes} min read</span>}
      </div>
    )
  }
  return NoteMeta
}) satisfies () => QuartzComponent
