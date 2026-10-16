import { parentKinds, type NodeKind } from './drag-collision.ts'

export type StoryNode = {
  id: string
  kind: NodeKind
  parentId?: string
  name: string
}

export type Project = {
  id: string
  name: string
  nodes: StoryNode[]
}

export type CreateTarget = {
  kind: NodeKind | 'project'
  parentId?: string
  afterId?: string
  mode?: 'manual' | 'ai'
}

export type DeleteTarget =
  | { type: 'project'; name: string }
  | { type: 'node'; node: StoryNode }

export const nodeKinds: NodeKind[] = ['role', 'epic', 'story', 'substory']

export const nodeLabels: Record<NodeKind, string> = {
  role: '角色',
  epic: '史诗',
  story: '用户故事',
  substory: '二级故事',
}

export const nodePrompts: Record<NodeKind | 'project', string> = {
  project: '例如：移动端改版',
  role: '例如：内容创作者',
  epic: '例如：发布内容',
  story: '例如：编辑一篇文章',
  substory: '例如：添加封面图片',
}

export const childKinds: Partial<Record<NodeKind, NodeKind>> = {
  role: 'epic',
  epic: 'story',
  story: 'substory',
}

// Mirrors the generate-children request limits in docs/backend-api.md.
export const aiCountRange = { min: 1, max: 10, default: 3 }
export const aiPromptMaxLength = 2000
export const aiDescendantRange = { min: 1, max: 5, default: 3 }
export const aiMaxGeneratedNodes = 100

/** The levels under kind, nearest first. */
export function levelsBelow(kind: NodeKind) {
  const levels: NodeKind[] = []
  for (let next = childKinds[kind]; next; next = childKinds[next]) levels.push(next)
  return levels
}

/** How many nodes of each level one generation creates under a node whose children are childKind. */
export function generationPlan(childKind: NodeKind, count: number, descendantCount?: number) {
  const levels = descendantCount ? [childKind, ...levelsBelow(childKind)] : [childKind]
  let perLevel = count
  return levels.map((kind) => {
    const level = { kind, count: perLevel }
    perLevel *= descendantCount ?? 0
    return level
  })
}

/** "2 个史诗、4 个用户故事" for created nodes or a plan, skipping empty levels. */
export function describeLevelCounts(levels: { kind: NodeKind; count: number }[]) {
  return levels.filter((level) => level.count > 0).map((level) => `${level.count} 个${nodeLabels[level.kind]}`).join('、')
}

export function countByKind(nodes: StoryNode[]) {
  return nodeKinds.map((kind) => ({ kind, count: nodes.filter((node) => node.kind === kind).length }))
}

export { parentKinds }

export function childrenOf(nodes: StoryNode[], parentId: string, kind: NodeKind) {
  return nodes.filter((node) => node.parentId === parentId && node.kind === kind)
}

export function descendantIds(nodes: StoryNode[], rootId: string) {
  const removed = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of nodes) {
      if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) {
        removed.add(item.id)
        changed = true
      }
    }
  }
  return removed
}

export function moveNode(nodes: StoryNode[], nodeID: string, parentID: string, orderedIDs: string[]) {
  const nodesByID = new Map(nodes.map((node) => [node.id, node]))
  const moved = nodesByID.get(nodeID)
  if (!moved) return nodes

  const ordered = orderedIDs.map((id) => {
    const node = nodesByID.get(id)!
    if (id !== nodeID) return node
    if (parentID) return { ...node, parentId: parentID }
    const { parentId: _, ...rootNode } = node
    return rootNode
  })
  const targetIDs = new Set(orderedIDs)
  return [...nodes.filter((node) => !targetIDs.has(node.id)), ...ordered]
}

export type ReorderPlan = { nodeId: string; parentId: string; nodeIds: string[] }

/**
 * Turns a drop of `activeId` onto `overId` into the order request the backend expects:
 * a same-kind target means "take its place", a parent-kind target means "append under it".
 */
export function planReorder(nodes: StoryNode[], activeId: string, overId: string): ReorderPlan | undefined {
  const activeNode = nodes.find((node) => node.id === activeId)
  const overNode = nodes.find((node) => node.id === overId)
  if (!activeNode || !overNode || activeId === overId) return undefined

  if (overNode.kind === activeNode.kind) {
    const parentId = overNode.parentId ?? ''
    const targetSiblings = nodes.filter((node) =>
      node.kind === activeNode.kind && (node.parentId ?? '') === parentId,
    )
    const withoutMoving = targetSiblings.filter((node) => node.id !== activeNode.id)
    const overIndex = withoutMoving.findIndex((node) => node.id === overNode.id)
    if (overIndex < 0) return undefined
    const order = withoutMoving.map((node) => node.id)
    if ((activeNode.parentId ?? '') === parentId) {
      // Same group: moving right lands after the target, moving left lands before it.
      const oldIndex = targetSiblings.findIndex((node) => node.id === activeNode.id)
      const newIndex = targetSiblings.findIndex((node) => node.id === overNode.id)
      order.splice(newIndex > oldIndex ? overIndex + 1 : overIndex, 0, activeNode.id)
    } else {
      order.splice(overIndex, 0, activeNode.id)
    }
    return { nodeId: activeNode.id, parentId, nodeIds: order }
  }

  if (parentKinds[activeNode.kind] === overNode.kind) {
    const nodeIds = nodes
      .filter((node) => node.id !== activeNode.id && node.kind === activeNode.kind && node.parentId === overNode.id)
      .map((node) => node.id)
    nodeIds.push(activeNode.id)
    return { nodeId: activeNode.id, parentId: overNode.id, nodeIds }
  }

  return undefined
}

/** Characters as the backend counts them (Unicode code points, not UTF-16 units). */
export function charCount(value: string) {
  return Array.from(value).length
}
