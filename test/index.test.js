import assert from 'node:assert/strict'
import { test } from 'vitest'

import { HUB_CORE_STATUS, HUB_TYPES } from '../src/index.js'

test('exports the supported hub types', () => {
  assert.deepEqual(HUB_TYPES, ['front-office', 'back-office'])
})

test('exports the package scaffold status', () => {
  assert.equal(HUB_CORE_STATUS, 'scaffolded')
})
