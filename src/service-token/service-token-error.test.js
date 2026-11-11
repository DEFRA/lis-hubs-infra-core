import { describe, expect, test } from 'vitest'

import { ServiceTokenError } from './service-token-error.js'

describe('ServiceTokenError', () => {
  test('it is a service unavailable error that keeps its cause', () => {
    // Arrange
    const cause = new Error('STS unreachable')

    // Act
    const error = new ServiceTokenError('Failed to get a service token', {
      cause
    })

    // Assert
    expect(error).toMatchObject({
      name: 'ServiceTokenError',
      statusCode: 503,
      cause
    })
  })
})
