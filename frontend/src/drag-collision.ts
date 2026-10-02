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
