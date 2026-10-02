import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('icon-only controls use stable direct buttons without portal tooltips', () => {
  assert.doesNotMatch(appSource, /\bTooltip\b/)
  assert.match(appSource, /className="node-add-action"[\s\S]*title="新增子节点"/)
  assert.match(appSource, /className="sibling-add-action"[\s\S]*title=\{`新增同级/)
  assert.match(appSource, /className="node-drag-action"[\s\S]*title="拖拽排序"/)
  assert.match(appSource, /aria-label="新建项目"[\s\S]*title="新建项目"/)
  assert.match(appSource, /className="nav-toggle"[\s\S]*title="打开项目导航"/)
  assert.match(appSource, /aria-label="项目操作" title="项目操作"/)
})
