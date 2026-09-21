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
  assert.match(
    appSource,
    /const isTransforming = isConnectorTransforming\(\{ transform, transition \}\)/,
  )
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

test('a transition without a transform keeps stable connectors visible', () => {
  assert.match(appSource, /isConnectorTransforming\(\{ transform, transition \}\)/)
  assert.doesNotMatch(appSource, /Boolean\(transform \|\| transition\)/)
})

test('horizontal connectors stop at the final node instead of the row add control', () => {
  assert.doesNotMatch(connectorStyles, /\.branch-children::before/)
  const horizontalRule = cssRuleStartingWith(
    '.branch-children > .map-branch:not(:last-child)::after',
  )
  assert.match(horizontalRule.declarations, /left:\s*4rem;/)
  assert.match(horizontalRule.declarations, /width:\s*calc\(100% \+ 1rem\);/)
  assert.match(horizontalRule.declarations, /height:\s*1px;/)
})

test('only connector segments touching a moving branch or drop target become dashed', () => {
  const verticalAffectedRule = cssRuleStartingWith(
    '.map-branch.is-transforming::before',
  )
  const requiredVerticalSelectors = [
    '.map-branch.is-transforming::before',
    '.map-branch.is-drop-target::before',
    '.map-branch.is-transforming > .branch-outgoing-connector',
    '.map-branch.is-drop-target > .branch-outgoing-connector',
  ]
  for (const selector of requiredVerticalSelectors) {
    assert.ok(
      verticalAffectedRule.selectors.includes(selector),
      `missing affected vertical connector selector: ${selector}`,
    )
  }
  assert.match(verticalAffectedRule.declarations, /repeating-linear-gradient\(/)
  assert.match(verticalAffectedRule.declarations, /to bottom/)
  assert.doesNotMatch(verticalAffectedRule.declarations, /opacity:\s*0/)

  const horizontalAffectedRule = cssRuleStartingWith(
    '.map-branch.is-transforming::after',
  )
  const requiredHorizontalSelectors = [
    '.map-branch.is-transforming::after',
    '.map-branch.is-drop-target::after',
    '.map-branch:has(+ .map-branch.is-transforming)::after',
    '.map-branch:has(+ .map-branch.is-drop-target)::after',
  ]
  for (const selector of requiredHorizontalSelectors) {
    assert.ok(
      horizontalAffectedRule.selectors.includes(selector),
      `missing affected horizontal connector selector: ${selector}`,
    )
  }
  assert.match(horizontalAffectedRule.declarations, /repeating-linear-gradient\(/)
  assert.match(horizontalAffectedRule.declarations, /to right/)
  assert.doesNotMatch(horizontalAffectedRule.declarations, /opacity:\s*0/)

  const overlyBroadSelectors = [
    '.branch-children:has(> .map-branch.is-transforming) > .map-branch::before',
    '.branch-children:has(> .map-branch.is-transforming) > .map-branch::after',
    '.map-branch.is-transforming .map-branch::before',
    '.map-branch.is-transforming .map-branch::after',
    '.map-branch.is-transforming .branch-outgoing-connector',
  ]
  for (const selector of overlyBroadSelectors) {
    assert.ok(
      !verticalAffectedRule.selectors.includes(selector)
        && !horizontalAffectedRule.selectors.includes(selector),
      `unaffected connector is marked by: ${selector}`,
    )
  }
})
