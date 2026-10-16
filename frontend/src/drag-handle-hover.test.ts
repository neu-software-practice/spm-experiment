import assert from 'node:assert/strict'
import test from 'node:test'
import { appSource } from './test-support.ts'


test('icon-only controls use stable direct buttons without portal tooltips', () => {
  assert.doesNotMatch(appSource, /\bTooltip\b/)
  assert.match(appSource, /className="node-add-action"[\s\S]*title="新增子节点"/)
  assert.match(appSource, /className="sibling-add-action"[\s\S]*title=\{`新增同级/)
  // The card itself is the drag activator; there is no separate handle button.
  assert.doesNotMatch(appSource, /node-drag-action|ArrowMove20Regular/)
  assert.match(appSource, /<Card\s+ref=\{drag\.setActivatorNodeRef\}\s+\{\.\.\.drag\.attributes\}\s+\{\.\.\.drag\.listeners\}/)
  assert.match(appSource, /aria-label="新建项目"[\s\S]*title="新建项目"/)
  assert.match(appSource, /className="nav-toggle"[\s\S]*title="打开项目导航"/)
  assert.match(appSource, /aria-label="项目操作" title="项目操作"/)
})
