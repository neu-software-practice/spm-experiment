/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyEvent,
  changedIds,
  finishTurn,
  parseEventStream,
  undoableTurnId,
  type AssistantEvent,
  type Turn,
} from './assistant.ts'
import { appSource, styles } from './test-support.ts'

const blank: Turn = { id: 't1', input: '帮我规划', blocks: [], status: 'streaming', changed: false, before: [] }

function play(events: AssistantEvent[], turn = blank) {
  return events.reduce(applyEvent, turn)
}

test('event stream frames are parsed across chunk boundaries', () => {
  const first = parseEventStream('event: text\ndata: {"text":"你"}\n\nevent: tool_pending\ndata: {"key":"0-0",')
  assert.deepEqual(first.events, [{ event: 'text', data: { text: '你' } }])
  const second = parseEventStream(first.rest + '"name":"add_nodes"}\n\nevent: broken\ndata: {nope\n\n')
  assert.deepEqual(second.events, [{ event: 'tool_pending', data: { key: '0-0', name: 'add_nodes' } }])
  assert.equal(second.rest, '')
  assert.deepEqual(parseEventStream('event: done\r\ndata: {"messages":[]}\r\n\r\n').events, [{ event: 'done', data: { messages: [] } }])
})

test('streamed events build reasoning, text and live tool blocks in order', () => {
  const turn = play([
    { event: 'reasoning', data: { text: '先想' } },
    { event: 'reasoning', data: { text: '一想' } },
    { event: 'text', data: { text: '好的，' } },
    { event: 'text', data: { text: '我来添加。' } },
    { event: 'tool_pending', data: { key: '0-0', name: 'add_nodes' } },
    { event: 'tool_start', data: { key: '0-0', name: 'add_nodes', args: {} } },
  ])
  assert.deepEqual(turn.blocks, [
    { type: 'reasoning', text: '先想一想', done: true },
    { type: 'text', text: '好的，我来添加。' },
    { type: 'tool', key: '0-0', name: 'add_nodes', status: 'running' },
  ])
  const ended = play([
    { event: 'tool_end', data: { key: '0-0', name: 'add_nodes', ok: true, summary: '新增 3 个史诗', error: '', changedIds: ['a', 'b'] } },
    { event: 'tool_end', data: { key: '0-1', name: 'rename_node', ok: false, summary: '', error: '节点不存在', changedIds: null } },
    { event: 'reasoning', data: { text: '再看看' } },
    { event: 'text', data: { text: '完成' } },
  ], turn)
  assert.deepEqual(ended.blocks.slice(2), [
    { type: 'tool', key: '0-0', name: 'add_nodes', status: 'done', summary: '新增 3 个史诗', error: '' },
    { type: 'tool', key: '0-1', name: 'rename_node', status: 'error', summary: '', error: '节点不存在' },
    { type: 'reasoning', text: '再看看', done: true },
    { type: 'text', text: '完成' },
  ])
})

test('changed node IDs come only from successful tools', () => {
  assert.deepEqual(changedIds({ event: 'tool_end', data: { key: 'k', name: 'add_nodes', ok: true, summary: '', error: '', changedIds: ['a'] } }), ['a'])
  assert.deepEqual(changedIds({ event: 'tool_end', data: { key: 'k', name: 'add_nodes', ok: false, summary: '', error: 'x', changedIds: ['a'] } }), [])
  assert.deepEqual(changedIds({ event: 'tool_end', data: { key: 'k', name: 'delete_nodes', ok: true, summary: '', error: '', changedIds: null } }), [])
})

test('finishing a turn marks unfinished tools as interrupted', () => {
  const turn = play([
    { event: 'reasoning', data: { text: '想' } },
    { event: 'tool_pending', data: { key: '0-0', name: 'delete_nodes' } },
  ])
  const stopped = finishTurn(turn, 'stopped')
  assert.equal(stopped.status, 'stopped')
  assert.deepEqual(stopped.blocks.at(-1), { type: 'tool', key: '0-0', name: 'delete_nodes', status: 'error', error: '已中断' })
})

test('only the latest finished turn that changed the map can be undone', () => {
  const done = { ...blank, status: 'done' as const }
  assert.equal(undoableTurnId([{ ...done, id: 'a', changed: true }, { ...done, id: 'b' }]), undefined)
  assert.equal(undoableTurnId([{ ...done, id: 'a' }, { ...done, id: 'b', changed: true }]), 'b')
  assert.equal(undoableTurnId([{ ...done, id: 'b', changed: true, undone: true }]), undefined)
  assert.equal(undoableTurnId([{ ...blank, changed: true }]), undefined)
})

test('the assistant replaces the one-shot AI generation entry points', () => {
  assert.doesNotMatch(appSource, /generate-children/)
  assert.match(appSource, /\/assistant\/chat`/)
  assert.match(appSource, /className="node-ai-action"[\s\S]*title="交给 AI 助手"/)
  assert.match(appSource, /onGenerate=\{childKind && props\.aiEnabled[\s\S]*?props\.onAsk\(/)
  assert.doesNotMatch(appSource, /<Tab value="ai"/)
})

test('assistant motion respects reduced-motion preferences', () => {
  const reduced = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'))
  for (const selector of ['.shimmer-text', '.assistant-tool-progress', '.assistant-turn', '.assistant-avatar.is-live']) {
    assert.ok(reduced.includes(selector), `${selector} keeps animating under reduced motion`)
  }
})

test('a retried model call discards what it streamed since the last finished tool', () => {
  const turn = play([
    { event: 'text', data: { text: '先建角色' } },
    { event: 'tool_pending', data: { key: '0-0', name: 'add_nodes' } },
    { event: 'tool_end', data: { key: '0-0', name: 'add_nodes', ok: true, summary: '新增 2 个角色', error: '', changedIds: [] } },
    { event: 'reasoning', data: { text: '再想想' } },
    { event: 'text', data: { text: '接着补' } },
    { event: 'tool_pending', data: { key: '1-0', name: 'add_nodes' } },
    { event: 'retry', data: { attempt: 1 } },
  ])
  assert.equal(turn.retrying, 1)
  assert.deepEqual(turn.blocks.map((block) => block.type), ['text', 'tool'])
  const resumed = applyEvent(turn, { event: 'reasoning', data: { text: '重新想' } })
  assert.equal(resumed.retrying, undefined)
  assert.equal(play([{ event: 'text', data: { text: 'x' } }, { event: 'retry', data: { attempt: 2 } }]).blocks.length, 0)
})

test('markdown tables from the model render as tables, not raw pipes', () => {
  assert.match(appSource, /className="markdown-table"/)
  assert.match(appSource, /\/\^:\?-\{2,\}:\?\$\/\.test\(cell\)/)
})
