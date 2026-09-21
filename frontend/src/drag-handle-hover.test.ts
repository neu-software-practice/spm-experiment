import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('drag activator uses a stable direct button without a portal tooltip', () => {
  assert.doesNotMatch(appSource, /<Tooltip content="拖拽排序"/)
  assert.match(appSource, /className="node-drag-action"[\s\S]*title="拖拽排序"/)
})
