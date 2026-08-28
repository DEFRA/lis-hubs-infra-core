import { createHmac } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

import { LogContextStore } from './log-context-store.js'

describe('LogContextStore', () => {
  describe('hashSecret', () => {
    test('it always returns null from the getter, even after being set', () => {
      // Arrange
      const store = new LogContextStore({ logger: { warn: vi.fn() } })

      // Act
      store.hashSecret = 'a-secret'

      // Assert
      expect(store.hashSecret).toBeNull()
    })

    test('it throws when a secret has already been set', () => {
      // Arrange
      const store = new LogContextStore({ logger: { warn: vi.fn() } })
      store.hashSecret = 'first-secret'
      let error

      // Act
      try {
        store.hashSecret = 'second-secret'
      } catch (e) {
        error = e
      }

      // Assert
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe('Hash secret already set')
    })
  })

  describe('set()', () => {
    test('it stores the raw value when hash is not requested', () => {
      // Arrange
      const store = new LogContextStore({ logger: { warn: vi.fn() } })

      // Act
      let result
      store.run(new Map(), () => {
        store.set('cph', '12/345/6789')
        result = store.get('cph')
      })

      // Assert
      expect(result).toBe('12/345/6789')
    })

    test('it stores the raw empty string when hash is requested but the value is empty', () => {
      // Arrange
      const store = new LogContextStore({ logger: { warn: vi.fn() } })
      store.hashSecret = 'a-secret'

      // Act
      let result
      store.run(new Map(), () => {
        store.set('user_email_hash', '', true)
        result = store.get('user_email_hash')
      })

      // Assert
      expect(result).toBe('')
    })

    test('it stores the HMAC-SHA256 hash of the value when hash is requested and hashSecret is configured', () => {
      // Arrange
      const testHashSecret = 'test-fixture-hash-secret'
      const store = new LogContextStore({ logger: { warn: vi.fn() } })
      store.hashSecret = testHashSecret
      // eslint-disable-next-line sonarjs/hardcoded-secret-signatures -- test fixture, not a real secret
      const expectedHash = createHmac('sha256', testHashSecret)
        .update('user@example.com')
        .digest('hex')

      // Act
      let result
      store.run(new Map(), () => {
        store.set('user_email_hash', 'user@example.com', true)
        result = store.get('user_email_hash')
      })

      // Assert
      expect(result).toBe(expectedHash)
    })

    test('it warns and stores nothing when hash is requested but hashSecret has not been configured', () => {
      // Arrange
      const warn = vi.fn()
      const store = new LogContextStore({ logger: { warn } })

      // Act
      let result
      store.run(new Map(), () => {
        store.set('user_email_hash', 'user@example.com', true)
        result = store.get('user_email_hash')
      })

      // Assert
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        '[LogContextStore] Cannot hash context value, hash secret not set.'
      )
    })
  })

  describe('get()', () => {
    test('it returns null when the key is not set', () => {
      // Arrange
      const store = new LogContextStore({ logger: { warn: vi.fn() } })

      // Act
      let result
      store.run(new Map(), () => {
        result = store.get('missing')
      })

      // Assert
      expect(result).toBeNull()
    })
  })
})
