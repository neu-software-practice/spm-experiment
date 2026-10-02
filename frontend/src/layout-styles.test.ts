/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

test('provider layout styles do not leak onto Fluent portal mount nodes', () => {
  // Fluent copies the provider className onto portals; a full-height background there hides the page behind dialogs.
  assert.match(appSource, /<FluentProvider theme=\{webLightTheme\} className="fluent-root">/)
  const unscoped = styles.match(/(?:^|\n)\.fluent-root\s*\{([^}]*)\}/)
  assert.doesNotMatch(unscoped?.[1] ?? '', /min-height|background/)
  assert.match(styles, /\.fluent-root:not\(\[data-portal-node\]\)\s*\{[^}]*min-height:\s*100vh;[^}]*background:/)
})

test('the sidebar divider does not stretch in the column layout', () => {
  assert.match(appSource, /<Divider className="sidebar-divider" \/>/)
  assert.match(styles, /\.project-sidebar > \.sidebar-divider\s*\{[^}]*flex:\s*none;/)
})

test('the sidebar is opaque so the map does not show through the narrow-screen overlay', () => {
  const sidebar = styles.match(/\n\.project-sidebar\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.match(sidebar, /background:\s*#[0-9a-f]{6};/i)
  assert.doesNotMatch(sidebar, /backdrop-filter|background:\s*rgba/)
})

test('node titles leave room for the drag handle and clamp to three lines', () => {
  const title = styles.match(/\.story-node > \.story-node-title\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.match(title, /padding-right:\s*22px;/)
  // Fluent Text atomic classes override display/overflow unless the selector is more specific.
  assert.match(title, /display:\s*-webkit-box;[\s\S]*overflow:\s*hidden;[\s\S]*-webkit-line-clamp:\s*3;/)
})

test('the add-child control sits on the card edge instead of over the kind badge', () => {
  assert.match(styles, /\.node-add-action\s*\{[^}]*bottom:\s*-14px;/)
  assert.match(appSource, /appearance="secondary"\s+size="small"\s+icon=\{<Add20Regular \/>\}\s+className="node-add-action"/)
})
