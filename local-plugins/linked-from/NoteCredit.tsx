import type { QuartzPluginData } from "../../quartz/plugins/vfile"
import { AUTHOR, CATALOGUE_URL, reportUrl, sourceUrl } from "./credit"

/**
 * The credit line at the end of a note: who writes the notes, where the source is, and a prefilled
 * issue link. Plain links, no form (the CSP has form-action 'self'), no script, no image.
 */
export function NoteCredit({ fileData }: { fileData: QuartzPluginData }) {
  const slug = fileData.slug!
  const title = String(fileData.frontmatter?.title ?? slug)
  const links = [
    { href: CATALOGUE_URL, text: "AI skills catalogue" },
    {
      href: fileData.relativePath ? sourceUrl(fileData.relativePath) : "",
      text: "Source on GitHub",
    },
    { href: reportUrl(slug, title), text: "Report an issue with this note" },
  ].filter((l) => l.href)
  return (
    <aside class="note-credit" aria-label="About this note">
      <p>
        Engineering notes by {AUTHOR}
        {links.map((l) => (
          <>
            <span class="note-credit-sep" aria-hidden="true">
              {" · "}
            </span>
            <a href={l.href} rel="noopener">
              {l.text}
            </a>
          </>
        ))}
      </p>
    </aside>
  )
}

export const noteCreditCss = `
.note-credit {
  margin: 2.5rem 0 0;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
}

.note-credit p {
  margin: 0;
  font: 400 0.8rem/1.7 var(--ui);
  color: var(--gray);
  overflow-wrap: anywhere;
}

.note-credit a {
  display: inline-block;
  padding: 0;
  background: none;
  color: var(--gray);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.note-credit a:hover {
  color: var(--secondary);
}

@media print {
  .note-credit {
    display: none;
  }
}
`
