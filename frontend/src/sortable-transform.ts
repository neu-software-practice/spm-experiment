import { CSS, type Transform } from '@dnd-kit/utilities'

export function sortableTransformToString(transform: Transform | null) {
  return CSS.Translate.toString(transform)
}

export function resolveDragSourceTransform(
  isDragging: boolean,
  sortableTransform: Transform | null,
  dragDelta: Transform | null,
) {
  if (!isDragging || sortableTransform) return sortableTransform
  return dragDelta
}
