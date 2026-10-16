/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { appSource, styles } from './test-support.ts'


test('same-level add control belongs to each node instead of a permanent row slot', () => {
  assert.doesNotMatch(appSource, /RowAddButton|row-add-slot|row-add-action/)
  assert.match(appSource, /className="sibling-add-action"/)
  // One recursive branch serves every level, so the sibling keeps the node's own kind and parent.
  assert.match(
    appSource,
    /onAddSibling=\{\(\) => props\.onCreate\(\{ kind: node\.kind, parentId: node\.parentId, afterId: node\.id \}\)\}/,
  )
  assert.match(appSource, /nodes: insertAfter\(project\.nodes, created, createTarget\.afterId\)/)
})

test('same-level add control is hidden until its node is hovered or the control is focused', () => {
  assert.match(styles, /\.sibling-add-action\s*\{[\s\S]*?opacity:\s*0;/)
  assert.match(styles, /\.sibling-add-action\s*\{[\s\S]*?pointer-events:\s*none;/)
  assert.match(styles, /\.node-slot:hover \.sibling-add-action/)
  assert.match(styles, /\.sibling-add-action:focus-visible/)
  assert.doesNotMatch(styles, /\.node-slot:focus-within \.sibling-add-action/)
  assert.match(styles, /right:\s*-0\.75rem;/)
  assert.match(styles, /transform:\s*translateX\(0\) scale\(1\);/)
  assert.match(styles, /opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/)
})
