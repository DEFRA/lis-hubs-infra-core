import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Boom from '@hapi/boom'

import { getServiceToken } from './service-token/issuer.js'
import { CircuitBreaker } from './circuit-breaker.js'
import { ServiceTokenError } from './base-client.js'
import { Spoke } from './spoke.js'

vi.mock('./service-token/issuer.js')
vi.mock('./circuit-breaker.js')

const mocks = {
  getServiceToken: vi.mocked(getServiceToken),
  CircuitBreaker: vi.mocked(CircuitBreaker),
  assertCallAllowed: vi.mocked(CircuitBreaker.prototype.assertCallAllowed),
  recordSuccess: vi.mocked(CircuitBreaker.prototype.recordSuccess),
  recordFailure: vi.mocked(CircuitBreaker.prototype.recordFailure)
}

function createSpoke(options = {}) {
  return new Spoke({
    moduleName: 'cattle-home',
    path: '/cattle',
    port: 3222,
    environment: 'local',
    timeout: 30000,
    cookieNames: ['livestock_hub_jwt'],
    ...options
  })
}

function createRequest() {
  return {
    params: { path: 'animals' },
    url: new URL('http://hub.test/cattle/animals'),
    headers: { cookie: 'livestock_hub_jwt=hub.jwt.value' }
  }
}

function createToolkit() {
  return {
    response: vi.fn().mockReturnValue({
      code: vi.fn().mockReturnThis(),
      passThrough: vi.fn().mockReturnValue('passed through')
    })
  }
}

describe('Spoke', () => {
  beforeEach(() => {
    mocks.getServiceToken.mockResolvedValue('service-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('it names the service after the module', () => {
    // Act
    const spoke = createSpoke()

    // Assert
    expect(spoke.serviceName).toBe('lis-apps-cattle-home')
    expect(spoke.path).toBe('/cattle')
  })

  test('it holds a breaker named after the service, with the given settings', () => {
    // Act
    const spoke = createSpoke({ circuitBreaker: { failureThreshold: 1 } })

    // Assert
    expect(mocks.CircuitBreaker).toHaveBeenCalledWith({
      name: 'lis-apps-cattle-home',
      failureThreshold: 1
    })
    expect(spoke.circuitBreaker).toBe(mocks.CircuitBreaker.mock.instances[0])
  })

  test('it proxies every method under its path with the timeout', () => {
    // Act
    const { route } = createSpoke({ timeout: 5000 })

    // Assert
    expect(route).toMatchObject({ method: '*', path: '/cattle/{path*}' })
    expect(route.handler.proxy).toMatchObject({
      passThrough: true,
      xforward: true,
      timeout: 5000
    })
    expect(route.handler.proxy.mapUri).toBeTypeOf('function')
    expect(route.handler.proxy.onResponse).toBeTypeOf('function')
  })

  describe('mapUri()', () => {
    test('it consults the breaker after the token fetch', async () => {
      // Arrange
      const spoke = createSpoke()

      // Act
      const mapped = await spoke.route.handler.proxy.mapUri(createRequest())

      // Assert
      expect(mapped).toEqual({
        uri: 'http://localhost:3222/animals',
        headers: {
          'x-forwarded-prefix': '/cattle',
          authorization: 'Bearer service-token',
          cookie: 'livestock_hub_jwt=hub.jwt.value'
        }
      })
      expect(mocks.assertCallAllowed).toHaveBeenCalledTimes(1)
      expect(mocks.getServiceToken.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.assertCallAllowed.mock.invocationCallOrder[0]
      )
    })

    test('it fails when the breaker refuses the call', async () => {
      // Arrange
      const spoke = createSpoke()
      const openError = new Error('Circuit open for lis-apps-cattle-home')
      mocks.assertCallAllowed.mockImplementationOnce(() => {
        throw openError
      })

      // Act
      let error
      try {
        await spoke.mapUri(createRequest())
      } catch (e) {
        error = e
      }

      // Assert
      expect(error).toBe(openError)
    })

    test('it does not consult the breaker when the service token fails', async () => {
      // Arrange
      const spoke = createSpoke()
      const stsError = new Error('sts down')
      mocks.getServiceToken.mockRejectedValueOnce(stsError)

      // Act
      let error
      try {
        await spoke.mapUri(createRequest())
      } catch (e) {
        error = e
      }

      // Assert
      expect(error).toBeInstanceOf(ServiceTokenError)
      expect(error.message).toBe(
        'Service token unavailable for spoke lis-apps-cattle-home'
      )
      expect(error.cause).toBe(stsError)
      expect(mocks.assertCallAllowed).not.toHaveBeenCalled()
    })
  })

  describe('onResponse()', () => {
    test.each([
      ['connection failure', 502],
      ['timeout', 504],
      ['failure without a status', undefined]
    ])('it records a failure on a %s', (_, statusCode) => {
      // Arrange
      const spoke = createSpoke()
      const upstreamError = statusCode
        ? Boom.boomify(new Error('Client request error'), { statusCode })
        : new Error('socket hang up')

      // Act
      const result = spoke.onResponse(upstreamError, undefined, {}, {})

      // Assert
      expect(result.output.statusCode).toBe(statusCode ?? 502)
      expect(mocks.recordFailure).toHaveBeenCalledTimes(1)
      expect(mocks.recordSuccess).not.toHaveBeenCalled()
    })

    test('it records nothing on a failure on the browser side of the proxy', () => {
      // Arrange
      const spoke = createSpoke()
      const clientError = Boom.boomify(new Error('Request aborted'), {
        statusCode: 400
      })

      // Act
      const result = spoke.onResponse(clientError, undefined, {}, {})

      // Assert
      expect(result.output.statusCode).toBe(400)
      expect(result.output.payload.message).toBe(
        'An internal server error occurred'
      )
      expect(mocks.recordFailure).not.toHaveBeenCalled()
      expect(mocks.recordSuccess).not.toHaveBeenCalled()
    })

    test.each([200, 404, 500])(
      'it records a success on a %i response and passes it through',
      (statusCode) => {
        // Arrange
        const spoke = createSpoke()
        const h = createToolkit()

        // Act
        const result = spoke.onResponse(null, { statusCode }, {}, h)

        // Assert
        expect(result).toBe('passed through')
        expect(mocks.recordSuccess).toHaveBeenCalledTimes(1)
        expect(mocks.recordFailure).not.toHaveBeenCalled()
      }
    )
  })
})
