/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  isActiveCardCenterWithinInitialRect,
  isEligibleNodeDropTarget,
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

test('a near-origin drag does not fall through to the nearest sibling', () => {
  const initialBranchRect = { top: 100, right: 228, bottom: 548, left: 100 }

  assert.equal(
    isActiveCardCenterWithinInitialRect(
      { top: 104, right: 232, bottom: 232, left: 104 },
      { top: 104, right: 232, bottom: 552, left: 104 },
      initialBranchRect,
    ),
    true,
  )
  assert.match(
    appSource,
    /isActiveCardCenterWithinInitialRect\([\s\S]*?activeCard\.getBoundingClientRect\(\),[\s\S]*?args\.collisionRect,[\s\S]*?args\.active\.rect\.current\.initial/,
  )
})

test('a large branch can target its parent after the card leaves its initial position', () => {
  const initialBranchRect = { top: 160, right: 228, bottom: 608, left: 100 }

  assert.equal(
    isActiveCardCenterWithinInitialRect(
      { top: 0, right: 228, bottom: 128, left: 100 },
      { top: 0, right: 228, bottom: 448, left: 100 },
      initialBranchRect,
    ),
    false,
  )
  assert.equal(
    isActiveCardCenterWithinInitialRect(
      { top: 0, right: 228, bottom: 128, left: 100 },
      { top: 0, right: 228, bottom: 448, left: 100 },
      null,
    ),
    false,
  )
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
