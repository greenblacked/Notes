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
    folder: "architecture",
    title: "Architecture",
    label: "Architecture",
    description:
      "Reference designs for the platform: cloud foundations, networking, cluster topology, reliability and cost, with the trade-offs behind them.",
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
    folder: "compliance",
    title: "Compliance",
    label: "Compliance",
    description:
      "Controls, audit evidence, access reviews and the software supply chain, and how the platform produces proof of them.",
  },
  {
    folder: "ai",
    title: "AI in DevOps",
    label: "AI",
    description:
      "Using AI agents and assistants in delivery and operations safely: access, review, provenance, incidents and rollout.",
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
  {
    folder: "learn",
    title: "Learning path",
    label: "Learn",
    description:
      "Lessons from first steps to middle level: Linux, networking, Git, containers, Kubernetes, GCP, CI/CD, Terraform and on-call.",
  },
]
