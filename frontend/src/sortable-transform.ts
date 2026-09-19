import { CSS, type Transform } from '@dnd-kit/utilities'

export function sortableTransformToString(transform: Transform | null) {
  return CSS.Translate.toString(transform)
}
