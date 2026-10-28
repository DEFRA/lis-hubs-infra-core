import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createServer } from 'node:http'

import Hapi from '@hapi/hapi'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { createProxyPlugin } from './proxy-plugin.js'
import { getServiceToken } from './service-token/issuer.js'

vi.mock('@defra/lis-hubs-infra-registry')
vi.mock('./service-token/issuer.js')

const mocks = {
  getModulesForHub: vi.mocked(getModulesForHub),
  getServiceToken: vi.mocked(getServiceToken)
}

describe('createProxyPlugin() against a real spoke', () => {
  let spoke
  let hub
  let spokeRequests

  beforeEach(async () => {
    spokeRequests = 0
    spoke = createServer()
    await new Promise((resolve) => spoke.listen(0, resolve))
    mocks.getModulesForHub.mockReturnValue([
      { id: 'cattle-home', path: '/cattle', port: spoke.address().port }
    ])
    mocks.getServiceToken.mockResolvedValue('service-token')
  })

  afterEach(async () => {
    await hub?.stop()
    spoke.closeAllConnections()
    await new Promise((resolve, reject) => {
      spoke.close((error) => (error ? reject(error) : resolve()))
    })
  })

  async function startHub(options = {}) {
    hub = Hapi.server()
    await hub.register(
      createProxyPlugin({
        hubId: 'back-office',
        environment: 'local',
        hubJwtCookieName: 'livestock_hub_jwt',
        proxyTimeout: 100,
        ...options
      }).plugin
    )
    await hub.initialize()
  }

  test('passes a spoke response through within the timeout', async () => {
    // Arrange
    spoke.on('request', (_request, response) => {
      spokeRequests += 1
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('from the spoke')
    })
    await startHub()

    // Act
    const response = await hub.inject({ method: 'GET', url: '/cattle/animals' })

    // Assert
    expect(response.statusCode).toBe(200)
    expect(response.payload).toBe('from the spoke')
    expect(spokeRequests).toBe(1)
  })

  test('answers 504 once the proxyTimeout passes without spoke response headers', async () => {
    // Arrange
    spoke.on('request', () => {
      spokeRequests += 1
      // Keep the connection open without sending response headers.
    })
    await startHub()
    const startedAt = Date.now()

    // Act
    const response = await hub.inject({ method: 'GET', url: '/cattle/animals' })

    // Assert
    expect(response.statusCode).toBe(504)
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(response.result).toEqual({
      statusCode: 504,
      error: 'Gateway Time-out',
      message: 'An internal server error occurred'
    })
    expect(spokeRequests).toBe(1)
  }, 2000)

  test('answers 503 without calling the spoke once its circuit is open', async () => {
    // Arrange
    spoke.on('request', () => {
      spokeRequests += 1
      // Keep the connection open without sending response headers.
    })
    await startHub({ circuitBreaker: { failureThreshold: 1 } })
    await hub.inject({ method: 'GET', url: '/cattle/animals' })

    // Act
    const response = await hub.inject({ method: 'GET', url: '/cattle/animals' })

    // Assert
    expect(response.statusCode).toBe(503)
    expect(spokeRequests).toBe(1)
  }, 2000)
})
