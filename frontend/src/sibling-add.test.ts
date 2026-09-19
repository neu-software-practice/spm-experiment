/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

test('same-level add control belongs to each node instead of a permanent row slot', () => {
  assert.doesNotMatch(appSource, /RowAddButton|row-add-slot|row-add-action/)
  assert.match(appSource, /className="sibling-add-action"/)
  assert.match(appSource, /onAddSibling=\{\(\) => props\.onCreate\(\{ kind: 'role', afterId: role\.id \}\)\}/)
  assert.match(appSource, /kind: 'epic', parentId: epic\.parentId, afterId: epic\.id/)
  assert.match(appSource, /kind: 'story', parentId: story\.parentId, afterId: story\.id/)
  assert.match(appSource, /kind: 'substory', parentId: story\.id, afterId: node\.id/)
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
