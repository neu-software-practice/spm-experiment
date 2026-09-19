/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { insertAfter } from './node-order.ts'

const first = { id: 'first' }
const second = { id: 'second' }
const created = { id: 'created' }

test('a contextual sibling is inserted between the anchor and its next sibling', () => {
  assert.deepEqual(
    insertAfter([first, second], created, first.id).map((item) => item.id),
    ['first', 'created', 'second'],
  )
})

test('a contextual sibling after the final node is appended', () => {
  assert.deepEqual(
    insertAfter([first, second], created, second.id).map((item) => item.id),
    ['first', 'second', 'created'],
  )
})

test('non-contextual creation retains append behavior', () => {
  assert.deepEqual(
    insertAfter([first, second], created).map((item) => item.id),
    ['first', 'second', 'created'],
  )
})
