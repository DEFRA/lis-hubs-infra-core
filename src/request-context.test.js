import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { clear, clearAll, get, plugin, set } from './request-context.js'

const mocks = {
  run: vi.spyOn(AsyncLocalStorage.prototype, 'run'),
  getStore: vi.spyOn(AsyncLocalStorage.prototype, 'getStore')
}

function getStoreFromRequest(headers) {
  const ext = vi.fn()
  const server = { ext }

  plugin.register(server)

  const handler = ext.mock.calls[0][1]
  const request = { headers, _lifecycle: vi.fn(), _postCycle: vi.fn() }

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

    test('onRequest wraps _lifecycle and _postCycle in an ALS context and continues', () => {
      // Arrange
      const ext = vi.fn()
      const server = { ext }
      plugin.register(server)
      const [[, handler]] = ext.mock.calls
      const h = { continue: Symbol('continue') }
      const lifecycle = vi.fn()
      const postCycle = vi.fn()
      const request = {
        headers: {},
        _lifecycle: lifecycle,
        _postCycle: postCycle
      }

      // Act
      const result = handler(request, h)

      // Assert
      expect(request._lifecycle).not.toBe(lifecycle)
      expect(request._postCycle).not.toBe(postCycle)
      request._lifecycle()
      request._postCycle()
      expect(mocks.run).toHaveBeenCalledTimes(2)
      const [firstStore] = mocks.run.mock.calls[0]
      const [secondStore] = mocks.run.mock.calls[1]
      expect(firstStore).toBe(secondStore)
      expect(firstStore).toBeInstanceOf(Map)
      expect(result).toBe(h.continue)
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
})
