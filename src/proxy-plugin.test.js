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

const getUserToken = () => 'hub.jwt.value'

function createOptions(options = {}) {
  return {
    hubId: 'back-office',
    environment: 'local',
    getUserToken,
    ...options
  }
}

describe('createProxyPlugin()', () => {
  beforeEach(() => {
    mocks.getModulesForHub.mockReturnValue([
      {
        id: 'cattle-home',
        path: '/holdings/{cph*3}/cattle',
        mounts: {
          holding: '/holdings/{cph*3}/cattle',
          animal: '/animals/cattle'
        },
        port: 3222
      }
    ])
    mocks.Spoke.mockImplementation(function ({ mounts }) {
      // The automock keeps the real class's `routes` getter on the prototype.
      Object.defineProperty(this, 'routes', {
        value: mounts.map((prefix) => ({
          method: '*',
          path: `${prefix}/{path*}`
        }))
      })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test.each([[undefined], [null], ['token']])(
    'requires getUserToken to be a function, rejecting %j',
    (invalidGetUserToken) => {
      // Act
      let error
      try {
        createProxyPlugin(createOptions({ getUserToken: invalidGetUserToken }))
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe(
        'createProxyPlugin requires a getUserToken function'
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
      mounts: ['/holdings/{cph*3}/cattle', '/animals/cattle'],
      port: 3222,
      environment: 'local',
      timeout: 30000,
      getUserToken,
      circuitBreaker: {}
    })
  })

  test('passes the timeout and breaker settings to each spoke', () => {
    // Act
    createProxyPlugin(
      createOptions({
        environment: 'prod',
        proxyTimeout: 5000,
        circuitBreaker: { failureThreshold: 2, resetTimeout: 100 }
      })
    )

    // Assert
    expect(mocks.Spoke).toHaveBeenCalledWith({
      moduleName: 'cattle-home',
      mounts: ['/holdings/{cph*3}/cattle', '/animals/cattle'],
      port: 3222,
      environment: 'prod',
      timeout: 5000,
      getUserToken,
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
      mocks.Spoke.mock.instances[0].routes
    )
  })
})
