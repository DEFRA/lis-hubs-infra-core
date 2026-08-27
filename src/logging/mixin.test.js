import { describe, expect, test, vi } from 'vitest'

import * as requestContext from '../request-context.js'
import { mixin } from './mixin.js'

vi.mock('../request-context.js')

const mocks = {
  get: vi.mocked(requestContext.get)
}

describe('mixin()', () => {
  test('it returns an empty object when nothing is set in the request context', () => {
    // Arrange
    mocks.get.mockReturnValue(null)

    // Act
    const result = mixin()

    // Assert
    expect(result).toEqual({})
  })

  test('it maps correlation_id onto trace.id', () => {
    // Arrange
    mocks.get.mockImplementation((key) =>
      key === 'correlation_id' ? 'correlation-1' : null
    )

    // Act
    const result = mixin()

    // Assert
    expect(result).toEqual({ trace: { id: 'correlation-1' } })
  })

  test('it maps user_id onto tenant.id', () => {
    // Arrange
    mocks.get.mockImplementation((key) =>
      key === 'user_id' ? 'hashed-user-1' : null
    )

    // Act
    const result = mixin()

    // Assert
    expect(result).toEqual({ tenant: { id: 'hashed-user-1' } })
  })

  test('it packs a single set field of origin_service, cph and animal_id into tenant.message', () => {
    // Arrange
    mocks.get.mockImplementation((key) =>
      key === 'cph' ? '12/345/6789' : null
    )

    // Act
    const result = mixin()

    // Assert
    expect(result).toEqual({ tenant: { message: 'cph=12/345/6789' } })
  })

  test('it packs multiple set fields of origin_service, cph and animal_id into tenant.message, space-separated and in field order', () => {
    // Arrange
    const values = {
      origin_service: 'front-office',
      cph: '12/345/6789',
      animal_id: 'UK123456789012'
    }
    mocks.get.mockImplementation((key) => values[key] ?? null)

    // Act
    const result = mixin()

    // Assert
    expect(result).toEqual({
      tenant: {
        message:
          'origin_service=front-office cph=12/345/6789 animal_id=UK123456789012'
      }
    })
  })

  test('it combines trace, tenant.id and tenant.message when everything is set in the request context', () => {
    // Arrange
    const values = {
      correlation_id: 'correlation-1',
      user_id: 'hashed-user-1',
      origin_service: 'front-office',
      cph: '12/345/6789',
      animal_id: 'UK123456789012'
    }
    mocks.get.mockImplementation((key) => values[key] ?? null)

    // Act
    const result = mixin()

    // Assert
    expect(result).toEqual({
      trace: { id: 'correlation-1' },
      tenant: {
        id: 'hashed-user-1',
        message:
          'origin_service=front-office cph=12/345/6789 animal_id=UK123456789012'
      }
    })
  })
})
