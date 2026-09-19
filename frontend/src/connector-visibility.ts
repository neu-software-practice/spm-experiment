import type { Transform } from '@dnd-kit/utilities'

export function isConnectorTransforming({
  transform,
}: {
  transform: Transform | null
  transition?: string
}) {
  return transform !== null
}
