import assert from 'node:assert/strict'
import test from 'node:test'
import { charCount, descendantIds, nodeKinds, planReorder, type StoryNode } from './model.ts'
import { styles } from './test-support.ts'

const nodes: StoryNode[] = [
  { id: 'r1', kind: 'role', name: '作者' },
  { id: 'r2', kind: 'role', name: '读者' },
  { id: 'e1', kind: 'epic', parentId: 'r1', name: '写作' },
  { id: 'e2', kind: 'epic', parentId: 'r1', name: '发布' },
  { id: 'e3', kind: 'epic', parentId: 'r1', name: '统计' },
  { id: 'e4', kind: 'epic', parentId: 'r2', name: '阅读' },
  { id: 's1', kind: 'story', parentId: 'e1', name: '草稿' },
  { id: 'ss1', kind: 'substory', parentId: 's1', name: '自动保存' },
]

test('reordering within a group follows the drag direction', () => {
  assert.deepEqual(planReorder(nodes, 'e1', 'e3'), { nodeId: 'e1', parentId: 'r1', nodeIds: ['e2', 'e3', 'e1'] })
  assert.deepEqual(planReorder(nodes, 'e3', 'e1'), { nodeId: 'e3', parentId: 'r1', nodeIds: ['e3', 'e1', 'e2'] })
  assert.deepEqual(planReorder(nodes, 'r2', 'r1'), { nodeId: 'r2', parentId: '', nodeIds: ['r2', 'r1'] })
})

test('dropping on a same-kind node under another parent takes its place there', () => {
  assert.deepEqual(planReorder(nodes, 'e2', 'e4'), { nodeId: 'e2', parentId: 'r2', nodeIds: ['e2', 'e4'] })
})

test('dropping on a parent-kind node appends under it', () => {
  assert.deepEqual(planReorder(nodes, 'e1', 'r2'), { nodeId: 'e1', parentId: 'r2', nodeIds: ['e4', 'e1'] })
})

test('drops that skip a level or hit the node itself are ignored', () => {
  assert.equal(planReorder(nodes, 's1', 'r1'), undefined)
  assert.equal(planReorder(nodes, 'e1', 'e1'), undefined)
  assert.equal(planReorder(nodes, 'missing', 'e1'), undefined)
})

test('deleting a node removes its whole subtree', () => {
  assert.deepEqual([...descendantIds(nodes, 'r1')].sort(), ['e1', 'e2', 'e3', 'r1', 's1', 'ss1'])
  assert.deepEqual([...descendantIds(nodes, 'e4')], ['e4'])
})

test('prompt length counts code points like the backend', () => {
  assert.equal(charCount('提示😀'), 3)
})

test('every node kind has its own colour tokens', () => {
  for (const kind of nodeKinds) {
    const rule = styles.match(new RegExp(`\\[data-kind='${kind}'\\]\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    for (const token of ['--kind-color', '--kind-ink', '--kind-tint', '--kind-stroke']) {
      assert.match(rule, new RegExp(`${token}:\\s*#[0-9a-f]{6};`, 'i'), `${kind} is missing ${token}`)
    }
  }
  assert.match(styles, /\.story-node::before\s*\{[^}]*background:\s*var\(--kind-color\);/)
})
