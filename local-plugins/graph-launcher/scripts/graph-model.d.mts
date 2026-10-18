// Types of graph-model.mjs, which is plain JavaScript so that node:test can run it unbuilt.

export type Depth = number | "all"
export interface GraphData {
  v: number
  nodes: { id: string; title: string; section: string; tags: string[]; d?: 1 }[]
  links: [string, string][]
}
export interface GNode {
  id: string
  title: string
  section: string
  kind: "note" | "tag"
  tags: string[]
  uses: number
  folder: boolean
}
export interface GLink {
  source: string
  target: string
  kind: "link" | "tag"
}
export interface Model {
  nodes: GNode[]
  links: GLink[]
  degree: Map<string, number>
  adj: Map<string, Set<string>>
  byId: Map<string, GNode>
  noteCount: number
  linkCount: number
}
export interface View {
  nodes: GNode[]
  links: GLink[]
  centre: string | null
  hops: Map<string, number>
  fellBack: boolean
}
export interface FilteredView extends View {
  matches: Set<string>
  /** True when a non-empty query is active, even with zero matches. */
  searching: boolean
}
export interface Settings {
  v: 1
  localDepth: Depth
  fullDepth: Depth
  tags: boolean
  orphans: boolean
  hidden: string[]
}

export const SETTINGS_KEY: string
export const MAX_DEPTH: number
export const TAG_PREFIX: string
export const OTHER_SECTION: string
export const TAG_SECTION: string
export const DEFAULT_SETTINGS: Readonly<Settings>

export function simplifySlug(slug: string): string
export function pathOf(node: { id: string; kind: "note" | "tag"; folder?: boolean }): string
export function decodeGraphData(data: unknown): GraphData | null
export function contentIndexToData(index: Record<string, any>, folders: string[]): GraphData
export function buildModel(data: GraphData, opts?: { tags?: boolean }): Model
export function neighbourhood(model: Model, centreId: string | null, depth: Depth): View
export function applyFilters(
  view: View,
  model: Model,
  opts?: { orphans?: boolean; hiddenSections?: Iterable<string>; query?: string },
): FilteredView
export function linkClickCloses(c: {
  onLink: boolean
  button?: number
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): boolean
export function clamp(v: number, lo: number, hi: number): number
export function radius(node: GNode, degree: number, isCentre: boolean): number
export function truncateLabel(title: string, max?: number): string
export function fitTransform(
  b: { x0: number; y0: number; x1: number; y1: number },
  w: number,
  h: number,
  pad?: number,
  minK?: number,
  maxK?: number,
): { k: number; x: number; y: number }
export function placeLabels<T extends { x: number; y: number; w: number; h: number }>(
  candidates: T[],
): T[]
export function groupByHops(view: View): { hop: number; items: GNode[] }[]
export function groupBySection(view: View, order: string[]): { section: string; items: GNode[] }[]
export function depthToSlider(d: Depth): number
export function sliderToDepth(v: unknown): Depth
export function sanitizeSettings(raw: unknown): Settings
