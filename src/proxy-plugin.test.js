import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { Spoke } from './spoke.js'
import { createProxyPlugin } from './proxy-plugin.js'

vi.mock('@defra/lis-hubs-infra-registry')
vi.mock('./spoke.js')

const mocks = {
  getModulesForHub: vi.mocked(getModulesForHub),
  Spoke: vi.mocked(Spoke)
}

function createOptions(options = {}) {
  return {
    hubId: 'back-office',
    environment: 'local',
    hubJwtCookieName: 'livestock_hub_jwt',
    ...options
  }
}

describe('createProxyPlugin()', () => {
  beforeEach(() => {
    mocks.getModulesForHub.mockReturnValue([
      { id: 'cattle-home', path: '/cattle', port: 3222 }
    ])
    mocks.Spoke.mockImplementation(function ({ path }) {
      // The automock keeps the real class's `route` getter on the prototype.
      Object.defineProperty(this, 'route', {
        value: { method: '*', path: `${path}/{path*}` }
      })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('requires the hub JWT cookie name', () => {
    // Act
    let error
    try {
      createProxyPlugin({ hubId: 'back-office', environment: 'local' })
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe('hubJwtCookieName is required')
  })

  test.each([['not an array'], [[42]], [['']]])(
    'rejects forwardedCookieNames %j',
    (forwardedCookieNames) => {
      // Act
      let error
      try {
        createProxyPlugin(createOptions({ forwardedCookieNames }))
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe(
        'forwardedCookieNames must be an array of cookie names'
      )
    }
  )

  test.each([0, -1, 1.5, '30000'])(
    'rejects a proxyTimeout of %s',
    (proxyTimeout) => {
      // Act
      let error
      try {
        createProxyPlugin(createOptions({ proxyTimeout }))
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe('proxyTimeout must be a positive integer')
    }
  )

  test.each([false, null, 'off'])(
    'rejects a circuitBreaker of %s',
    (circuitBreaker) => {
      // Act
      let error
      try {
        createProxyPlugin(createOptions({ circuitBreaker }))
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe('circuitBreaker must be an object of settings')
    }
  )

  test('creates a spoke for each of the hub modules, with a 30 second timeout and default breaker settings', () => {
    // Act
    createProxyPlugin(createOptions())

    // Assert
    expect(mocks.getModulesForHub).toHaveBeenCalledWith('back-office')
    expect(mocks.Spoke).toHaveBeenCalledTimes(1)
    expect(mocks.Spoke).toHaveBeenCalledWith({
      moduleName: 'cattle-home',
      path: '/cattle',
      port: 3222,
      environment: 'local',
      timeout: 30000,
      cookieNames: ['livestock_hub_jwt'],
      circuitBreaker: {}
    })
  })

  test('passes the timeout, forwarded cookie names and breaker settings to each spoke', () => {
    // Act
    createProxyPlugin(
      createOptions({
        environment: 'prod',
        forwardedCookieNames: ['cookies_policy'],
        proxyTimeout: 5000,
        circuitBreaker: { failureThreshold: 2, resetTimeout: 100 }
      })
    )

    // Assert
    expect(mocks.Spoke).toHaveBeenCalledWith({
      moduleName: 'cattle-home',
      path: '/cattle',
      port: 3222,
      environment: 'prod',
      timeout: 5000,
      cookieNames: ['livestock_hub_jwt', 'cookies_policy'],
      circuitBreaker: { failureThreshold: 2, resetTimeout: 100 }
    })
  })

  test('registers h2o2 and each spoke route on the server', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin(createOptions())

    // Act
    await proxy.plugin.register(server)

    // Assert
    expect(proxy.plugin.name).toBe('proxy')
    expect(server.register).toHaveBeenCalledWith(h2o2)
    expect(server.route).toHaveBeenCalledTimes(1)
    expect(server.route).toHaveBeenCalledWith(
      mocks.Spoke.mock.instances[0].route
    )
  })

  test('sorts modules with the longest path first so a shorter prefix does not swallow a longer one', async () => {
    // Arrange
    mocks.getModulesForHub.mockReturnValue([
      { id: 'cattle-home', path: '/cattle', port: 3221 },
      { id: 'cattle-register', path: '/cattle/register', port: 3201 }
    ])
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin(createOptions({ hubId: 'front-office' }))

    // Act
    await proxy.plugin.register(server)

    // Assert
    expect(mocks.getModulesForHub).toHaveBeenCalledWith('front-office')
    expect(
      mocks.Spoke.mock.calls.map(([{ moduleName }]) => moduleName)
    ).toEqual(['cattle-register', 'cattle-home'])
    expect(server.route.mock.calls.map(([{ path }]) => path)).toEqual([
      '/cattle/register/{path*}',
      '/cattle/{path*}'
    ])
  })
})
