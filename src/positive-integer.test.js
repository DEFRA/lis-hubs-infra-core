import { describe, expect, test } from 'vitest'

import { positiveInteger } from './positive-integer.js'

describe('positiveInteger()', () => {
  test.each([1, 30000])('it returns %s', (value) => {
    // Act
    const result = positiveInteger('timeout', value)

    // Assert
    expect(result).toBe(value)
  })

  test.each([0, -1, 1.5, '30000', null, undefined, NaN])(
    'it rejects %s, naming the option',
    (value) => {
      // Act
      let error
      try {
        positiveInteger('timeout', value)
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe('timeout must be a positive integer')
    }
  )
})
