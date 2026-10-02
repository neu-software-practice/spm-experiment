/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  horizontalCenterDistance,
  isActiveCardCenterWithinInitialHorizontalRange,
  isEligibleNodeDropTarget,
  isTargetInDragDirection,
  type NodeKind,
} from './drag-collision.ts'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

const parentTargets: Array<[active: NodeKind, parent: NodeKind]> = [
  ['substory', 'story'],
  ['story', 'epic'],
  ['epic', 'role'],
]

test('an active sortable is never eligible as its own collision target', () => {
  for (const kind of ['role', 'epic', 'story', 'substory'] satisfies NodeKind[]) {
    assert.equal(isEligibleNodeDropTarget('active', kind, 'active', kind), false)
  }
})

test('a drag inside its initial horizontal range does not fall through to a sibling', () => {
  const initialBranchRect = { top: 100, right: 228, bottom: 548, left: 100 }

  assert.equal(
    isActiveCardCenterWithinInitialHorizontalRange(
      { top: -300, right: 232, bottom: -172, left: 104 },
      { top: -300, right: 232, bottom: 148, left: 104 },
      initialBranchRect,
    ),
    true,
  )
  assert.match(
    appSource,
    /isActiveCardCenterWithinInitialHorizontalRange\([\s\S]*?activeCardRect,[\s\S]*?args\.collisionRect,[\s\S]*?args\.active\.rect\.current\.initial/,
  )
})

test('a card leaves its initial horizontal range only after moving sideways', () => {
  const initialBranchRect = { top: 160, right: 228, bottom: 608, left: 100 }

  assert.equal(
    isActiveCardCenterWithinInitialHorizontalRange(
      { top: 0, right: 360, bottom: 128, left: 232 },
      { top: 0, right: 360, bottom: 448, left: 232 },
      initialBranchRect,
    ),
    false,
  )
  assert.equal(
    isActiveCardCenterWithinInitialHorizontalRange(
      { top: 0, right: 228, bottom: 128, left: 100 },
      { top: 0, right: 228, bottom: 448, left: 100 },
      null,
    ),
    false,
  )
})

test('same-level target distance ignores vertical position', () => {
  const active = { top: 500, right: 428, bottom: 628, left: 300 }
  const nearXFarY = { top: -1000, right: 460, bottom: -872, left: 332 }
  const farXSameY = { top: 500, right: 728, bottom: 628, left: 600 }

  assert.equal(horizontalCenterDistance(active, nearXFarY), 32)
  assert.equal(horizontalCenterDistance(active, farXSameY), 300)
  assert.ok(
    horizontalCenterDistance(active, nearXFarY)
      < horizontalCenterDistance(active, farXSameY),
  )
  assert.match(appSource, /value: horizontalCenterDistance\(activeCardRect, rect\)/)
})

test('a directly hovered legal parent takes priority over horizontal sibling sorting', () => {
  const parentHitIndex = appSource.indexOf('if (directParentHits.length > 0)')
  const siblingSortIndex = appSource.indexOf('const sameKindContainers')

  assert.ok(parentHitIndex >= 0)
  assert.ok(siblingSortIndex > parentHitIndex)
})

test('upward parent targets and same-kind sorting targets remain eligible', () => {
  for (const [activeKind, parentKind] of parentTargets) {
    assert.equal(
      isEligibleNodeDropTarget('active', activeKind, 'parent', parentKind),
      true,
      `${activeKind} should be accepted by ${parentKind}`,
    )
  }

  for (const kind of ['role', 'epic', 'story', 'substory'] satisfies NodeKind[]) {
    assert.equal(isEligibleNodeDropTarget('active', kind, 'sibling', kind), true)
  }
})

test('invalid levels are ignored without producing a drop target', () => {
  assert.equal(isEligibleNodeDropTarget('active', 'substory', 'epic', 'epic'), false)
  assert.equal(isEligibleNodeDropTarget('active', 'story', 'role', 'role'), false)
  assert.equal(isEligibleNodeDropTarget('active', 'epic', 'story', 'story'), false)
  assert.equal(isEligibleNodeDropTarget('active', 'role', 'epic', 'epic'), false)
})

test('the collision detector applies the eligibility guard before measuring targets', () => {
  assert.match(
    appSource,
    /isEligibleNodeDropTarget\(args\.active\.id, activeKind, container\.id, kind\)/,
  )
})

test('same-level targets behind the drag direction are ignored', () => {
  // B starts at 785..913; A (previous sibling with a wide subtree) is far left,
  // C (child of the next role) is directly right. Dragging B 100px left must not target C.
  const initialBranchRect = { top: 245, right: 913, bottom: 532, left: 785 }
  const movedCard = { top: 245, right: 813, bottom: 372, left: 685 }
  const movedBranch = { top: 245, right: 813, bottom: 532, left: 685 }
  const previousSibling = { top: 245, right: 481, bottom: 372, left: 353 }
  const nextParentChild = { top: 245, right: 1057, bottom: 372, left: 929 }

  assert.equal(isTargetInDragDirection(movedCard, movedBranch, initialBranchRect, previousSibling), true)
  assert.equal(isTargetInDragDirection(movedCard, movedBranch, initialBranchRect, nextParentChild), false)
})

test('dragging right only targets nodes to the right of the starting position', () => {
  const initialBranchRect = { top: 0, right: 228, bottom: 128, left: 100 }
  const movedCard = { top: 0, right: 328, bottom: 128, left: 200 }
  const left = { top: 0, right: 84, bottom: 128, left: -44 }
  const right = { top: 0, right: 372, bottom: 128, left: 244 }

  assert.equal(isTargetInDragDirection(movedCard, movedCard, initialBranchRect, left), false)
  assert.equal(isTargetInDragDirection(movedCard, movedCard, initialBranchRect, right), true)
  assert.equal(isTargetInDragDirection(movedCard, movedCard, null, left), true)
})

test('the collision detector filters same-level targets by drag direction', () => {
  assert.match(
    appSource,
    /isTargetInDragDirection\([\s\S]*?activeCardRect,[\s\S]*?args\.collisionRect,[\s\S]*?args\.active\.rect\.current\.initial,[\s\S]*?rect,?[\s\S]*?\)/,
  )
})
