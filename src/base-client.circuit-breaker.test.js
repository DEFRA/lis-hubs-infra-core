import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import Wreck from '@hapi/wreck'

import * as requestContext from './request-context.js'
import { getServiceBaseUrl } from './get-service-base-url.js'
import { getServiceToken } from './service-token/issuer.js'
import { CircuitBreaker } from './circuit-breaker.js'
import { BaseClient, ServiceTokenError } from './base-client.js'

vi.mock('./request-context.js')
vi.mock('./get-service-base-url.js')
vi.mock('./service-token/issuer.js')
vi.mock('./circuit-breaker.js')

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
  return new BaseClient({
    environment: 'local',
    serviceName: 'lis-be4fe-cattle-home',
    port: 8085,
    ...options
  })
}

function rejectRequest(statusCode) {
  const wreckError = new Error('connect ECONNREFUSED')
  wreckError.output = { statusCode }
  vi.spyOn(Wreck, 'request').mockRejectedValue(wreckError)
  return wreckError
}

describe('BaseClient circuit breaker', () => {
  beforeEach(() => {
    mocks.requestContextGetHeaders.mockReturnValue({
      'x-correlation-id': 'correlation-1'
    })
    mocks.getServiceBaseUrl.mockReturnValue(new URL('http://localhost:8085'))
    mocks.getServiceToken.mockResolvedValue('service-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  test('it holds a breaker named after the service, with the given settings', () => {
    // Act
    createClient({ circuitBreaker: { failureThreshold: 2, resetTimeout: 100 } })

    // Assert
    expect(mocks.CircuitBreaker).toHaveBeenCalledWith({
      name: 'lis-be4fe-cattle-home',
      failureThreshold: 2,
      resetTimeout: 100
    })
  })

  test('it holds a breaker with the default settings when none are given', () => {
    // Act
    createClient()

    // Assert
    expect(mocks.CircuitBreaker).toHaveBeenCalledWith({
      name: 'lis-be4fe-cattle-home'
    })
  })

  test('it holds no breaker when disabled, and makes the call unguarded', async () => {
    // Arrange
    const client = createClient({ circuitBreaker: false })
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/cattle')

    // Assert
    expect(mocks.CircuitBreaker).not.toHaveBeenCalled()
    expect(mocks.assertCallAllowed).not.toHaveBeenCalled()
    expect(Wreck.request).toHaveBeenCalledTimes(1)
  })

  test('it consults the breaker after the token fetch and immediately before the request', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/cattle')

    // Assert
    expect(mocks.assertCallAllowed).toHaveBeenCalledTimes(1)
    expect(mocks.getServiceToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertCallAllowed.mock.invocationCallOrder[0]
    )
    expect(mocks.assertCallAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      Wreck.request.mock.invocationCallOrder[0]
    )
  })

  test('it fails without calling the service when the breaker refuses the call', async () => {
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
      await client._get('api/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBe(openError)
    expect(Wreck.request).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
    expect(mocks.recordFailure).not.toHaveBeenCalled()
  })

  test('it does not consult the breaker when the service token fails', async () => {
    // Arrange
    const client = createClient()
    mocks.getServiceToken.mockRejectedValueOnce(new Error('sts down'))

    // Act
    let error
    try {
      await client._get('api/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(ServiceTokenError)
    expect(mocks.assertCallAllowed).not.toHaveBeenCalled()
    expect(mocks.recordFailure).not.toHaveBeenCalled()
  })

  test.each([
    ['connection failure', 502],
    ['headers timeout', 504]
  ])('it records a failure on a %s', async (_, statusCode) => {
    // Arrange
    const client = createClient()
    rejectRequest(statusCode)

    // Act
    let error
    try {
      await client._get('api/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.statusCode).toBe(statusCode)
    expect(mocks.recordFailure).toHaveBeenCalledTimes(1)
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('it records a failure on a body read timeout', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    const readTimeout = new Error('Client request timeout')
    readTimeout.output = { statusCode: 408 }
    vi.spyOn(Wreck, 'read').mockRejectedValue(readTimeout)

    // Act
    let error
    try {
      await client._get('api/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.statusCode).toBe(504)
    expect(mocks.recordFailure).toHaveBeenCalledTimes(1)
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('it records a success on an unreadable body, which is still a response', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockRejectedValue(new Error('Invalid JSON'))

    // Act
    let error
    try {
      await client._get('api/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.statusCode).toBe(200)
    expect(mocks.recordSuccess).toHaveBeenCalledTimes(1)
    expect(mocks.recordFailure).not.toHaveBeenCalled()
  })

  test.each([200, 404, 500])(
    'it records a success on a %i response',
    async (statusCode) => {
      // Arrange
      const client = createClient()
      vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode })
      vi.spyOn(Wreck, 'read').mockResolvedValue({})

      // Act
      await client._get('api/cattle').catch(() => undefined)

      // Assert
      expect(mocks.recordSuccess).toHaveBeenCalledTimes(1)
      expect(mocks.recordFailure).not.toHaveBeenCalled()
    }
  )
})
