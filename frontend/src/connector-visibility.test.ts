/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { isConnectorTransforming } from './connector-visibility.ts'

test('stable connectors stay visible even when dnd-kit returns a transition', () => {
  assert.equal(isConnectorTransforming({ transform: null }), false)
  assert.equal(
    isConnectorTransforming({ transform: null, transition: 'transform 200ms ease' }),
    false,
  )
})

test('connectors hide only for a real transform and return after it clears', () => {
  const transform = { x: 24, y: 0, scaleX: 1, scaleY: 1 }

  assert.equal(isConnectorTransforming({ transform }), true)
  assert.equal(
    isConnectorTransforming({ transform: null, transition: 'transform 200ms ease' }),
    false,
  )
})
