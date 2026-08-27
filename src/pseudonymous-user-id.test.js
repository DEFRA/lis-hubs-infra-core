import { describe, expect, test } from 'vitest'

import { derivePseudonymousUserId } from './pseudonymous-user-id.js'

describe('derivePseudonymousUserId()', () => {
  test('it returns the same id for the same email and secret', () => {
    // Arrange
    const email = 'keeper@example.com'
    const secret = 'test-user-id-secret'

    // Act
    const first = derivePseudonymousUserId(email, secret)
    const second = derivePseudonymousUserId(email, secret)

    // Assert
    expect(first).toBe(second)
  })

  test('it returns different ids for different emails', () => {
    // Arrange
    const secret = 'test-user-id-secret'

    // Act
    const first = derivePseudonymousUserId('keeper-1@example.com', secret)
    const second = derivePseudonymousUserId('keeper-2@example.com', secret)

    // Assert
    expect(first).not.toBe(second)
  })

  test('it returns different ids for the same email with different secrets', () => {
    // Arrange
    const email = 'keeper@example.com'

    // Act
    const first = derivePseudonymousUserId(email, 'secret-one')
    const second = derivePseudonymousUserId(email, 'secret-two')

    // Assert
    expect(first).not.toBe(second)
  })

  test('it returns null when the email is missing', () => {
    // Arrange
    // Act
    const result = derivePseudonymousUserId(undefined, 'test-user-id-secret')

    // Assert
    expect(result).toBeNull()
  })

  test('it returns null when the secret is missing', () => {
    // Arrange
    // Act
    const result = derivePseudonymousUserId('keeper@example.com', undefined)

    // Assert
    expect(result).toBeNull()
  })
})
