// Types of scroll-tuck.mjs, which is plain JavaScript so that node:test can run it unbuilt.

export interface TuckState {
  tucked: boolean
  lastY: number
  travel: number
}
export interface TuckInput {
  y: number
  maxY: number
  topZone: number
  hold: boolean
  threshold?: number
}
export const TUCK_THRESHOLD: number
export function initialTuck(y?: number): TuckState
export function nextTuck(state: TuckState, input: TuckInput): TuckState
