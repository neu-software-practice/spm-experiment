/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { CSS } from '@dnd-kit/utilities'
import { readFileSync } from 'node:fs'
import { resolveDragSourceTransform, sortableTransformToString } from './sortable-transform.ts'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('sortable branches translate without inheriting dnd-kit scale', () => {
  const transform = { x: 18, y: -9, scaleX: 1.75, scaleY: 0.6 }

  const fullTransform = CSS.Transform.toString(transform)
  assert.match(fullTransform ?? '', /scaleX\(1\.75\) scaleY\(0\.6\)/)

  const branchTransform = sortableTransformToString(transform)
  assert.equal(branchTransform, 'translate3d(18px, -9px, 0)')
  assert.doesNotMatch(branchTransform ?? '', /scale/i)
})

test('the dragged branch keeps following the pointer over another parent', () => {
  const sortableTransform = { x: -144, y: 0, scaleX: 1, scaleY: 1 }
  const dragDelta = { x: -96, y: 4, scaleX: 1, scaleY: 1 }

  // dnd-kit returns no transform for the drag source when `over` belongs to another SortableContext.
  assert.deepEqual(resolveDragSourceTransform(true, null, dragDelta), dragDelta)
  assert.deepEqual(resolveDragSourceTransform(true, sortableTransform, dragDelta), sortableTransform)
  assert.equal(resolveDragSourceTransform(false, null, dragDelta), null)
  assert.deepEqual(resolveDragSourceTransform(false, sortableTransform, dragDelta), sortableTransform)
  assert.match(appSource, /resolveDragSourceTransform\(isDragging, sortableTransform, dragDelta\)/)
})
