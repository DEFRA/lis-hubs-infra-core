import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  clear,
  clearAll,
  get,
  getHeaders,
  plugin,
  set
} from './request-context.js'

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
      expect(mocks.run).toHaveBeenCalledTimes(2)
      const [firstStore] = mocks.run.mock.calls[0]
      const [secondStore] = mocks.run.mock.calls[1]
      expect(firstStore).toBe(secondStore)
      expect(firstStore).toBeInstanceOf(Map)
      expect(result).toBe(h.continue)
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

    test('onRequest stores origin_service, cph, animal_id and user_id from their x-lis-* headers when trustLisHeaders is true', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest(
        {
          'x-lis-origin-service': 'front-office',
          'x-lis-cph-number': '12/345/6789',
          'x-lis-animal-id': 'UK123456789012',
          'x-lis-user-id': 'hashed-user-1'
        },
        { trustLisHeaders: true }
      )

      // Assert
      expect(store.get('origin_service')).toBe('front-office')
      expect(store.get('cph')).toBe('12/345/6789')
      expect(store.get('animal_id')).toBe('UK123456789012')
      expect(store.get('user_id')).toBe('hashed-user-1')
    })

    test('onRequest does not set origin_service, cph, animal_id or user_id when their headers are missing', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest({}, { trustLisHeaders: true })

      // Assert
      expect(store.has('origin_service')).toBe(false)
      expect(store.has('cph')).toBe(false)
      expect(store.has('animal_id')).toBe(false)
      expect(store.has('user_id')).toBe(false)
    })

    test('onRequest only stores the x-lis-* headers that are present when trustLisHeaders is true', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest(
        { 'x-lis-cph-number': '12/345/6789' },
        { trustLisHeaders: true }
      )

      // Assert
      expect(store.get('cph')).toBe('12/345/6789')
      expect(store.has('origin_service')).toBe(false)
      expect(store.has('animal_id')).toBe(false)
      expect(store.has('user_id')).toBe(false)
    })

    test('onRequest ignores x-lis-* headers by default, even when present, so a client cannot inject them at a hub', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest({
        'x-lis-origin-service': 'front-office',
        'x-lis-cph-number': '12/345/6789',
        'x-lis-animal-id': 'UK123456789012',
        'x-lis-user-id': 'hashed-user-1'
      })

      // Assert
      expect(store.has('origin_service')).toBe(false)
      expect(store.has('cph')).toBe(false)
      expect(store.has('animal_id')).toBe(false)
      expect(store.has('user_id')).toBe(false)
    })

    test('onRequest ignores x-lis-* headers when trustLisHeaders is explicitly false', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest(
        { 'x-lis-cph-number': '12/345/6789' },
        { trustLisHeaders: false }
      )

      // Assert
      expect(store.has('cph')).toBe(false)
    })

    test('onRequest still stores correlation_id when trustLisHeaders is false', () => {
      // Arrange
      // Act
      const store = getStoreFromRequest(
        { 'x-cdp-request-id': 'cdp-1' },
        { trustLisHeaders: false }
      )

      // Assert
      expect(store.get('correlation_id')).toBe('cdp-1')
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
      expect(error?.message).toBe('No request context available')
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
      expect(error?.message).toBe('No request context available')
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
      expect(error?.message).toBe('No request context available')
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
    test('it returns the x-lis-* headers for whichever context values are set', () => {
      // Arrange
      const store = new Map([
        ['origin_service', 'front-office'],
        ['cph', '12/345/6789'],
        ['animal_id', 'UK123456789012'],
        ['user_id', 'hashed-user-1']
      ])
      mocks.getStore.mockReturnValue(store)

      // Act
      const result = getHeaders()

      // Assert
      expect(result).toEqual({
        'x-lis-origin-service': 'front-office',
        'x-lis-cph-number': '12/345/6789',
        'x-lis-animal-id': 'UK123456789012',
        'x-lis-user-id': 'hashed-user-1'
      })
    })

    test('it omits headers for context values that are not set', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map([['cph', '12/345/6789']]))

      // Act
      const result = getHeaders()

      // Assert
      expect(result).toEqual({ 'x-lis-cph-number': '12/345/6789' })
    })

    test('it returns an empty object when no context values are set', () => {
      // Arrange
      mocks.getStore.mockReturnValue(new Map())

      // Act
      const result = getHeaders()

      // Assert
      expect(result).toEqual({})
    })
  })
})
