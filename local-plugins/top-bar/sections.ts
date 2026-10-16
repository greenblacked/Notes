/**
 * The sections of the site, in reading order: the first folder of a note's slug. Shared by the top
 * bar (`label` is the link text), the home page (`title` and `description` head the section cards
 * and the index) and nothing else needs to know the list.
 */
export interface Section {
  folder: string
  title: string
  label: string
  description: string
}

export const SECTIONS: Section[] = [
  {
    folder: "adr",
    title: "Architecture decisions",
    label: "ADRs",
    description: "Numbered, immutable records of significant decisions and their context.",
  },
  {
    folder: "patterns",
    title: "Patterns",
    label: "Patterns",
    description: "Reusable, tested ways of building things on the platform.",
  },
  {
    folder: "tools",
    title: "Tools",
    label: "Tools",
    description: "Comparisons and evaluations of tools, with the reasoning behind the choice.",
  },
  {
    folder: "runbooks",
    title: "Runbooks",
    label: "Runbooks",
    description: "Step-by-step operational procedures: release, roll back, recover.",
  },
  {
    folder: "management",
    title: "Engineering management",
    label: "Management",
    description: "Running a platform team: people, hiring, planning, delivery and on-call health.",
  },
  {
    folder: "standards",
    title: "Standards",
    label: "Standards",
    description: "How the team works: notes, production changes, code review and postmortems.",
  },
]
