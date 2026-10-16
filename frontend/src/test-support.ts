/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs'

const srcDir = new URL('./', import.meta.url)

/** All application source under `src` (tests excluded), concatenated, for tests that assert on markup or wiring. */
export const appSource = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file) && !/(\.test|test-support)\.ts$/.test(file))
  .sort()
  .map((file) => readFileSync(new URL(file, srcDir), 'utf8'))
  .join('\n')

export const styles = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
