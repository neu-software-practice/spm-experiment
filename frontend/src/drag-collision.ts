export type NodeKind = 'role' | 'epic' | 'story' | 'substory'

export const parentKinds: Partial<Record<NodeKind, NodeKind>> = {
  epic: 'role',
  story: 'epic',
  substory: 'story',
}

type Rect = {
  top: number
  right: number
  bottom: number
  left: number
}

export function isActiveCardCenterWithinInitialHorizontalRange(
  currentCardRect: Rect,
  currentBranchRect: Rect,
  initialBranchRect: Rect | null,
) {
  if (!initialBranchRect) return false
  const deltaX = currentBranchRect.left - initialBranchRect.left
  const initialLeft = currentCardRect.left - deltaX
  const initialRight = currentCardRect.right - deltaX
  const centerX = (currentCardRect.left + currentCardRect.right) / 2
  return centerX >= initialLeft && centerX <= initialRight
}

export function isTargetInDragDirection(
  currentCardRect: Rect,
  currentBranchRect: Rect,
  initialBranchRect: Rect | null,
  targetRect: Rect,
) {
  if (!initialBranchRect) return true
  const deltaX = currentBranchRect.left - initialBranchRect.left
  if (deltaX === 0) return true
  const initialCenterX = (currentCardRect.left + currentCardRect.right) / 2 - deltaX
  const targetCenterX = (targetRect.left + targetRect.right) / 2
  return deltaX < 0 ? targetCenterX < initialCenterX : targetCenterX > initialCenterX
}

/** Share of the target card's width the dragged card's center must travel into before they swap. */
export const SIBLING_SWAP_DEPTH = 0.25

/**
 * Whether a same-level target is close enough to swap with: the dragged card's center has to enter
 * the target card from the drag side and pass SIBLING_SWAP_DEPTH of its width. Leaving the starting
 * slot alone is not enough, so a neighbour with a wide subtree no longer swaps after a short nudge.
 */
export function isWithinSiblingSwapZone(
  currentCardRect: Rect,
  currentBranchRect: Rect,
  initialBranchRect: Rect | null,
  targetRect: Rect,
) {
  if (!initialBranchRect) return true
  const deltaX = currentBranchRect.left - initialBranchRect.left
  const centerX = (currentCardRect.left + currentCardRect.right) / 2
  const inset = (targetRect.right - targetRect.left) * SIBLING_SWAP_DEPTH
  if (deltaX > 0) return centerX >= targetRect.left + inset
  if (deltaX < 0) return centerX <= targetRect.right - inset
  return false
}

export function horizontalCenterDistance(first: Rect, second: Rect) {
  const firstCenterX = (first.left + first.right) / 2
  const secondCenterX = (second.left + second.right) / 2
  return Math.abs(firstCenterX - secondCenterX)
}

export function isEligibleNodeDropTarget(
  activeID: string | number,
  activeKind: NodeKind | undefined,
  targetID: string | number,
  targetKind: NodeKind | undefined,
) {
  if (targetID === activeID) return false
  return !activeKind || targetKind === activeKind || targetKind === parentKinds[activeKind]
}
