/** Display helpers shared by the spec sheet (note-meta) and the home page index (note-index). */

export const TYPE_LABELS: Record<string, string> = {
  adr: "ADR",
  pattern: "Pattern",
  tool: "Tool",
  standard: "Standard",
  runbook: "Runbook",
  note: "Note",
}

/** Chip colour class per status. Anything else gets the neutral style. */
export const STATUS_TONES: Record<string, "accepted" | "proposed" | "warning"> = {
  accepted: "accepted",
  proposed: "proposed",
  deprecated: "warning",
  superseded: "warning",
  rejected: "warning",
}

const own = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key)

/** Label for a `type` value; unknown values (including `constructor` and the like) as written. */
export const typeLabel = (type: string): string =>
  own(TYPE_LABELS, type) ? TYPE_LABELS[type] : type

/** Chip tone for a `status` value; unknown values are neutral. */
export const statusTone = (status: string): string =>
  own(STATUS_TONES, status) ? STATUS_TONES[status] : "neutral"

/**
 * YAML turns an unquoted `2026-10-11` into a Date (midnight UTC), while a quoted one stays a
 * string. Accept both and read the calendar day without a time zone shift. Returns `YYYY-MM-DD`,
 * or undefined for anything else, including impossible dates such as 2026-13-45 or 2026-02-30
 * (which are not shown as written).
 */
export function isoDay(value: unknown): string | undefined {
  let iso: string | undefined
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined
    iso = value.toISOString().slice(0, 10)
  } else if (typeof value === "string") {
    iso = value.trim()
  }
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!m) return undefined
  const check = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (check.getUTCMonth() !== Number(m[2]) - 1 || check.getUTCDate() !== Number(m[3])) {
    return undefined
  }
  return `${m[1]}-${m[2]}-${m[3]}`
}

export const asLowerString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : undefined
