/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { CSS } from '@dnd-kit/utilities'
import { sortableTransformToString } from './sortable-transform.ts'

test('sortable branches translate without inheriting dnd-kit scale', () => {
  const transform = { x: 18, y: -9, scaleX: 1.75, scaleY: 0.6 }

  const fullTransform = CSS.Transform.toString(transform)
  assert.match(fullTransform ?? '', /scaleX\(1\.75\) scaleY\(0\.6\)/)

  const branchTransform = sortableTransformToString(transform)
  assert.equal(branchTransform, 'translate3d(18px, -9px, 0)')
  assert.doesNotMatch(branchTransform ?? '', /scale/i)
})
