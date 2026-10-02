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
