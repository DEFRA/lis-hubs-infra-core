import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import Wreck from '@hapi/wreck'

import * as requestContext from '../request-context.js'
import { getServiceBaseUrl } from '../get-service-base-url.js'
import { getServiceToken } from '../service-token/issuer.js'
import { CircuitBreaker } from '../circuit-breaker.js'
import { createServiceClient } from './index.js'

vi.mock('../request-context.js')
vi.mock('../get-service-base-url.js')
vi.mock('../service-token/issuer.js')
vi.mock('../circuit-breaker.js')

const mocks = {
  requestContextGetHeaders: vi.mocked(requestContext.getHeaders),
  getServiceBaseUrl: vi.mocked(getServiceBaseUrl),
  getServiceToken: vi.mocked(getServiceToken),
  CircuitBreaker: vi.mocked(CircuitBreaker),
  assertCallAllowed: vi.mocked(CircuitBreaker.prototype.assertCallAllowed),
  recordSuccess: vi.mocked(CircuitBreaker.prototype.recordSuccess),
  recordFailure: vi.mocked(CircuitBreaker.prototype.recordFailure)
}

function createClient(options = {}) {
  return createServiceClient({
    environment: 'local',
    serviceName: 'lis-be4fe-cattle-home',
    port: 8085,
    ...options
  })
}

beforeEach(() => {
  mocks.requestContextGetHeaders.mockReturnValue({
    'x-correlation-id': 'correlation-1',
    'x-cdp-request-id': 'correlation-1'
  })
  mocks.getServiceBaseUrl.mockReturnValue(new URL('http://localhost:8085'))
  mocks.getServiceToken.mockResolvedValue('service-token')
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('circuit breaker', () => {
  test('it is configured with the given settings', () => {
    // Act
    createClient({ circuitBreaker: { failureThreshold: 2, resetTimeout: 100 } })

    // Assert
    expect(mocks.CircuitBreaker).toHaveBeenCalledWith({
      name: 'lis-be4fe-cattle-home',
      failureThreshold: 2,
      resetTimeout: 100
    })
  })

  test('it is consulted after the token fetch and immediately before the request', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client.get('api/cattle')

    // Assert
    expect(mocks.assertCallAllowed).toHaveBeenCalledTimes(1)
    expect(mocks.getServiceToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCallAllowed.mock.invocationCallOrder[0]
    )
    expect(mocks.assertCallAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      Wreck.request.mock.invocationCallOrder[0]
    )
  })

  test('it fails the call without calling the service when it refuses', async () => {
    // Arrange
    const client = createClient()
    const openError = new Error('Circuit open for lis-be4fe-cattle-home')
    mocks.assertCallAllowed.mockImplementationOnce(() => {
      throw openError
    })
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })

    // Act
    let error
    try {
      await client.get('api/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBe(openError)
    expect(Wreck.request).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
    expect(mocks.recordFailure).not.toHaveBeenCalled()
  })

  test('it is not created when disabled, and the call is unguarded', async () => {
    // Arrange
    const client = createClient({ circuitBreaker: false })
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client.get('api/cattle')

    // Assert
    expect(mocks.CircuitBreaker).not.toHaveBeenCalled()
    expect(mocks.assertCallAllowed).not.toHaveBeenCalled()
    expect(Wreck.request).toHaveBeenCalledTimes(1)
  })
})
