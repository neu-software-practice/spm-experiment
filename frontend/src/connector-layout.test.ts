/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const connectorStyles = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

function cssRuleStartingWith(selector: string) {
  const start = connectorStyles.indexOf(selector)
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`)
  const declarationStart = connectorStyles.indexOf('{', start)
  const declarationEnd = connectorStyles.indexOf('}', declarationStart)
  assert.ok(declarationStart > start && declarationEnd > declarationStart)
  return {
    selectors: connectorStyles
      .slice(start, declarationStart)
      .split(',')
      .map((item) => item.trim()),
    declarations: connectorStyles.slice(declarationStart + 1, declarationEnd),
  }
}

test('sortable transforms are isolated from the branch connector layer', () => {
  assert.match(appSource, /ref=\{setNodeRef\}[\s\S]*?className=\{`map-branch/)
  assert.match(appSource, /className="branch-visual"\s+style=\{style\}/)
  assert.match(appSource, /const isTransforming = Boolean\(transform \|\| transition\)/)
  assert.match(
    appSource,
    /className=\{`map-branch\$\{isTransforming \? ' is-transforming' : ''\}\$\{isDragging/,
  )
  assert.doesNotMatch(
    appSource,
    /<div\s+ref=\{setNodeRef\}[^>]*style=\{style\}[^>]*>/,
  )
  assert.match(
    appSource,
    /\{hasChildren && <span className="branch-outgoing-connector" aria-hidden="true" \/>\}/,
  )
  assert.match(appSource, /:scope > \.branch-visual > \.node-slot/)
})

test('horizontal connectors stop at the final node instead of the row add control', () => {
  assert.doesNotMatch(connectorStyles, /\.branch-children::before/)
  const horizontalRule = cssRuleStartingWith(
    '.branch-children > .map-branch:not(:has(+ .row-add-slot))::after',
  )
  assert.match(horizontalRule.declarations, /left:\s*4rem;/)
  assert.match(horizontalRule.declarations, /width:\s*calc\(100% \+ 1rem\);/)
  assert.match(horizontalRule.declarations, /height:\s*1px;/)
})

test('connectors inside a transforming subtree are suppressed until it is stable', () => {
  const hiddenRule = cssRuleStartingWith(
    '.branch-children:has(> .map-branch.is-transforming) > .map-branch::before',
  )
  const requiredSelectors = [
    '.branch-children:has(> .map-branch.is-transforming) > .map-branch::before',
    '.branch-children:has(> .map-branch.is-transforming) > .map-branch::after',
    '.map-branch:has(> .branch-visual > .branch-children > .map-branch.is-transforming) > .branch-outgoing-connector',
    '.map-branch.is-transforming::before',
    '.map-branch.is-transforming::after',
    '.map-branch.is-transforming .map-branch::before',
    '.map-branch.is-transforming .map-branch::after',
    '.map-branch.is-transforming .branch-outgoing-connector',
  ]
  for (const selector of requiredSelectors) {
    assert.ok(hiddenRule.selectors.includes(selector), `missing hidden connector selector: ${selector}`)
  }
  assert.match(hiddenRule.declarations, /^\s*opacity:\s*0;\s*$/)
})
