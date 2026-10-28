import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { createProxyPlugin } from './proxy-plugin.js'
import { getServiceToken } from './service-token/issuer.js'

vi.mock('@defra/lis-hubs-infra-registry')
vi.mock('./service-token/issuer.js')

const mocks = {
  getModulesForHub: vi.mocked(getModulesForHub),
  getServiceToken: vi.mocked(getServiceToken)
}

describe('createProxyPlugin() timeout and circuit breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModulesForHub.mockReturnValue([
      { id: 'cattle-home', path: '/cattle', port: 3222 }
    ])
    mocks.getServiceToken.mockResolvedValue('service-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('waits 30 seconds for a spoke by default', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt'
    })

    // Act
    await proxy.plugin.register(server)

    // Assert
    expect(server.route.mock.calls[0][0].handler.proxy.timeout).toBe(30000)
  })

  test('waits the configured proxyTimeout for a spoke', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt',
      proxyTimeout: 5000
    })

    // Act
    await proxy.plugin.register(server)

    // Assert
    expect(server.route.mock.calls[0][0].handler.proxy.timeout).toBe(5000)
  })

  test.each([0, -1, 1.5, '30000'])(
    'rejects a proxyTimeout of %s',
    (proxyTimeout) => {
      // Act
      let error
      try {
        createProxyPlugin({
          hubId: 'back-office',
          environment: 'local',
          hubJwtCookieName: 'livestock_hub_jwt',
          proxyTimeout
        })
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
        createProxyPlugin({
          hubId: 'back-office',
          environment: 'local',
          hubJwtCookieName: 'livestock_hub_jwt',
          circuitBreaker
        })
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe('circuitBreaker must be an object of settings')
    }
  )
})
