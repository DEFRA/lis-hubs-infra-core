import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  clear,
  clearAll,
  get,
  getHeaders,
  has,
  plugin,
  set
} from './request-context.js'
import { logger } from './logging/index.js'

const mocks = {
  run: vi.spyOn(AsyncLocalStorage.prototype, 'run'),
  getStore: vi.spyOn(AsyncLocalStorage.prototype, 'getStore')
}

function getStoreFromRequest(headers, options) {
  const ext = vi.fn()
  const server = { ext }

  plugin.register(server, options)

  const handler = ext.mock.calls[0][1]
  const request = { headers, _lifecycle: vi.fn(), _reply: vi.fn() }

  handler(request, { continue: Symbol('continue') })
  request._lifecycle()

  const [store] = mocks.run.mock.calls[0]
  return store
}

describe('requestContext', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('plugin', () => {
    test('it registers an onRequest extension', () => {
      // Arrange
      const ext = vi.fn()
      const server = { ext }

      // Act
      plugin.register(server)

      // Assert
      expect(ext).toHaveBeenCalledWith('onRequest', expect.any(Function))
    })

    test('onRequest wraps _lifecycle and _reply in an ALS context and continues', () => {
      // Arrange
      const ext = vi.fn()
      const server = { ext }
      plugin.register(server)
      const [[, handler]] = ext.mock.calls
      const h = { continue: Symbol('continue') }
      const lifecycle = vi.fn()
      const reply = vi.fn()
      const request = {
        headers: {},
        _lifecycle: lifecycle,
        _reply: reply
      }

      // Act
      const result = handler(request, h)

      // Assert
      expect(request._lifecycle).not.toBe(lifecycle)
      expect(request._reply).not.toBe(reply)
      request._lifecycle()
      request._reply()
      expect(mocks.run).toHaveBeenCalledTimes(4)
      const [firstStore] = mocks.run.mock.calls[0]
      const [secondStore] = mocks.run.mock.calls[1]
      const [thirdStore] = mocks.run.mock.calls[2]
      const [fourthStore] = mocks.run.mock.calls[3]
      expect(firstStore).toBe(thirdStore)
      expect(firstStore).toBeInstanceOf(Map)
      expect(secondStore).toBe(fourthStore)
      expect(secondStore).toBeInstanceOf(Map)
      expect(result).toBe(h.continue)
    })

    test('a value set on logger.context during _lifecycle is still visible during _reply', () => {
      // Arrange
      const ext = vi.fn()
      const server = { ext }
      plugin.register(server)
      const [[, handler]] = ext.mock.calls
      const h = { continue: Symbol('continue') }
      let valueSeenDuringReply
      const request = {
        headers: {},
        _lifecycle: vi.fn(() => {
          logger.context.set('user_email_hash', 'hashed-value')
        }),
        _reply: vi.fn(() => {
          valueSeenDuringReply = logger.context.get('user_email_hash')
        })
      }

      // Act
      handler(request, h)
      request._lifecycle()
      request._reply()

      // Assert
      expect(valueSeenDuringReply).toBe('hashed-value')
    })

    test('onRequest forwards arguments through _reply to the original method', () => {
      // Arrange
      const ext = vi.fn()
      const server = { ext }
      plugin.register(server)
      const [[, handler]] = ext.mock.calls
      const h = { continue: Symbol('continue') }
      const reply = vi.fn()
      const request = { headers: {}, _lifecycle: vi.fn(), _reply: reply }
      const exit = new Error('boom')

      // Act
      handler(request, h)
      request._reply(exit)

      // Assert
      expect(reply).toHaveBeenCalledWith(exit)
    })

    test('onRequest stores correlation_id from the x-cdp-request-id header', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest({ 'x-cdp-request-id': 'cdp-1' })

      // Assert
      expect(store.get('correlation_id')).toBe('cdp-1')
    })

    test('onRequest generates a correlation_id when the header is missing', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest({})

      // Assert
      expect(typeof store.get('correlation_id')).toBe('string')
      expect(store.get('correlation_id').length).toBeGreaterThan(0)
    })
  })

  describe('has()', () => {
    test('it returns false when there is no store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(undefined)

      // Act
      const result = has('foo')

      // Assert
      expect(result).toBe(false)
    })

    test('it returns false when the key is not in the store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map())

      // Act
      const result = has('foo')

      // Assert
      expect(result).toBe(false)
    })

    test('it returns true when the key is in the store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map([['foo', 'bar']]))

      // Act
      const result = has('foo')

      // Assert
      expect(result).toBe(true)
    })
  })

  describe('get()', () => {
    test('it returns null when there is no store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(undefined)

      // Act
      const result = get('foo')

      // Assert
      expect(result).toBeNull()
    })

    test('it returns null when the key is not in the store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map())

      // Act
      const result = get('foo')

      // Assert
      expect(result).toBeNull()
    })

    test('it returns the value when the key is in the store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map([['foo', 'bar']]))

      // Act
      const result = get('foo')

      // Assert
      expect(result).toBe('bar')
    })
  })

  describe('set()', () => {
    test('it throws when there is no store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(undefined)
      let error

      // Act
      try {
        set('foo', 'bar')
      } catch (e) {
        error = e
      }

      // Assert
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe('No store available')
    })

    test('it sets the value on the store', () => {
      // Arrange
      const store = new Map()
      mocks.getStore.mockReturnValue(store)

      // Act
      set('foo', 'bar')

      // Assert
      expect(store.get('foo')).toBe('bar')
    })
  })

  describe('clear()', () => {
    test('it throws when there is no store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(undefined)
      let error

      // Act
      try {
        clear('foo')
      } catch (e) {
        error = e
      }

      // Assert
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe('No store available')
    })

    test('it removes the key from the store', () => {
      // Arrange
      const store = new Map([['foo', 'bar']])
      mocks.getStore.mockReturnValue(store)

      // Act
      clear('foo')

      // Assert
      expect(store.has('foo')).toBe(false)
    })
  })

  describe('clearAll()', () => {
    test('it throws when there is no store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(undefined)
      let error

      // Act
      try {
        clearAll()
      } catch (e) {
        error = e
      }

      // Assert
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe('No store available')
    })

    test('it removes all keys from the store', () => {
      // Arrange
      const store = new Map([
        ['foo', 'bar'],
        ['baz', 'qux']
      ])
      mocks.getStore.mockReturnValue(store)

      // Act
      clearAll()

      // Assert
      expect(store.size).toBe(0)
    })
  })

  describe('getHeaders()', () => {
    test('it returns the x-cdp-request-id header when correlation_id is set', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map([['correlation_id', 'cdp-1']]))

      // Act
      const result = getHeaders()

      // Assert
      expect(result).toEqual({ 'x-cdp-request-id': 'cdp-1' })
    })

    test('it returns an empty object when correlation_id is not set', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map())

      // Act
      const result = getHeaders()

      // Assert
      expect(result).toEqual({})
    })

    test('it returns an empty object when there is no store', () => {
      // Arrange
      mocks.getStore.mockReturnValue(undefined)

      // Act
      const result = getHeaders()

      // Assert
      expect(result).toEqual({})
    })
  })
})
