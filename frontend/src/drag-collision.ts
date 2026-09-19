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

export function isActiveCardCenterWithinInitialRect(
  currentCardRect: Rect,
  currentBranchRect: Rect,
  initialBranchRect: Rect | null,
) {
  if (!initialBranchRect) return false
  const deltaX = currentBranchRect.left - initialBranchRect.left
  const deltaY = currentBranchRect.top - initialBranchRect.top
  const initialCardRect = {
    top: currentCardRect.top - deltaY,
    right: currentCardRect.right - deltaX,
    bottom: currentCardRect.bottom - deltaY,
    left: currentCardRect.left - deltaX,
  }
  const centerX = (currentCardRect.left + currentCardRect.right) / 2
  const centerY = (currentCardRect.top + currentCardRect.bottom) / 2
  return centerX >= initialCardRect.left && centerX <= initialCardRect.right
    && centerY >= initialCardRect.top && centerY <= initialCardRect.bottom
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
