// Types of to-top.mjs, which is plain JavaScript so that node:test can run it unbuilt.

export interface RevealState {
  shown: boolean
  lastY: number
  travel: number
}
export interface RevealInput {
  y: number
  maxY: number
  limit: number
  hold: boolean
  focused: boolean
  step?: number
}
export const REVEAL_STEP: number
export const MIN_REVEAL: number
export function revealFrom(viewportH?: number): number
export function initialReveal(y?: number): RevealState
export function nextReveal(state: RevealState, input: RevealInput): RevealState
