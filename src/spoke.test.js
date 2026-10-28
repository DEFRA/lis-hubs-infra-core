import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Boom from '@hapi/boom'

import { getServiceToken } from './service-token/issuer.js'
import { logger } from './logging/index.js'
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

function createRequest({ path = 'animals', search = '', headers = {} } = {}) {
  const subPath = path ? `/${path}` : ''
  return {
    params: path ? { path } : {},
    url: new URL(`http://hub.test/cattle${subPath}${search}`),
    headers
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
    vi.restoreAllMocks()
  })

  test('it names the service after the module', () => {
    // Act
    const spoke = createSpoke()

    // Assert
    expect(spoke.serviceName).toBe('lis-apps-cattle-home')
    expect(spoke.path).toBe('/cattle')
  })

  test('it rejects an unsupported environment', () => {
    // Act
    let error
    try {
      createSpoke({ environment: 'unknown' })
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe('Unsupported environment: unknown')
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
    test.each([
      // Local proxying intentionally uses HTTP because the services run locally.
      ['local', 'http://localhost:3222'],
      // docker_compose reaches every service via the host's published ports -
      // there's no reliable compose service-name discovery to lean on instead.
      ['docker_compose', 'http://host.docker.internal:3222'],
      ['test', 'https://lis-apps-cattle-home.test.cdp-int.defra.cloud'],
      ['prod', 'https://lis-apps-cattle-home.prod.cdp-int.defra.cloud']
    ])('it targets the %s spoke', async (environment, expectedBaseUri) => {
      // Arrange
      const spoke = createSpoke({ environment })

      // Act
      const withPath = await spoke.mapUri(
        createRequest({ path: 'summary-data' })
      )
      const withoutPath = await spoke.mapUri(createRequest({ path: '' }))

      // Assert
      expect(withPath.uri).toBe(`${expectedBaseUri}/summary-data`)
      expect(withoutPath.uri).toBe(expectedBaseUri)
    })

    test('it forwards the incoming query string', async () => {
      // Arrange
      const spoke = createSpoke()

      // Act
      const mapped = await spoke.mapUri(
        createRequest({ search: '?sort=sex&direction=asc&page=1' })
      )

      // Assert
      expect(mapped.uri).toBe(
        'http://localhost:3222/animals?sort=sex&direction=asc&page=1'
      )
    })

    test('it sends a service token for the spoke in place of the inbound authorization, which passThrough must not see', async () => {
      // Arrange
      const spoke = createSpoke()
      const request = createRequest({
        headers: { authorization: 'Bearer browser-token', accept: 'text/html' }
      })

      // Act
      const mapped = await spoke.route.handler.proxy.mapUri(request)

      // Assert
      expect(mocks.getServiceToken).toHaveBeenCalledWith('lis-apps-cattle-home')
      expect(mapped.headers).toEqual({
        'x-forwarded-prefix': '/cattle',
        authorization: 'Bearer service-token'
      })
      expect(request.headers).toEqual({ accept: 'text/html' })
    })

    test('it forwards only the hub JWT cookie', async () => {
      // Arrange
      const spoke = createSpoke()
      const request = createRequest({
        headers: {
          cookie:
            'front-office-session=abc; livestock_hub_jwt=hub.jwt.value; other=1'
        }
      })

      // Act
      const mapped = await spoke.mapUri(request)

      // Assert
      expect(mapped.headers.cookie).toBe('livestock_hub_jwt=hub.jwt.value')
      expect(request.headers).toEqual({})
    })

    test('it forwards the named cookies alongside the hub JWT, in the browser order', async () => {
      // Arrange
      const spoke = createSpoke({
        cookieNames: ['livestock_hub_jwt', 'cookies_policy']
      })
      const request = createRequest({
        headers: {
          cookie:
            'cookies_policy=%7B%22analytics%22%3Afalse%7D; front-office-session=abc; livestock_hub_jwt=hub.jwt.value'
        }
      })

      // Act
      const mapped = await spoke.mapUri(request)

      // Assert
      expect(mapped.headers.cookie).toBe(
        'cookies_policy=%7B%22analytics%22%3Afalse%7D; livestock_hub_jwt=hub.jwt.value'
      )
      expect(request.headers).toEqual({})
    })

    test('it forwards a named cookie on its own when there is no hub JWT cookie', async () => {
      // Arrange
      const spoke = createSpoke({
        cookieNames: ['livestock_hub_jwt', 'cookies_policy']
      })
      const request = createRequest({
        headers: { cookie: 'front-office-session=abc; cookies_policy=x' }
      })

      // Act
      const mapped = await spoke.mapUri(request)

      // Assert
      expect(mapped.headers.cookie).toBe('cookies_policy=x')
    })

    test('it sends no cookie when none of the named cookies are present', async () => {
      // Arrange
      const spoke = createSpoke()
      const request = createRequest({
        headers: { cookie: 'front-office-session=abc' }
      })

      // Act
      const mapped = await spoke.mapUri(request)

      // Assert
      expect(mapped.headers).toEqual({
        'x-forwarded-prefix': '/cattle',
        authorization: 'Bearer service-token'
      })
      expect(request.headers).toEqual({})
    })

    test('it consults the breaker after the token fetch', async () => {
      // Arrange
      const spoke = createSpoke()

      // Act
      await spoke.mapUri(createRequest())

      // Assert
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

    test('it rejects with an error naming the spoke, without consulting the breaker or logging, when the service token cannot be obtained', async () => {
      // Arrange
      const spoke = createSpoke()
      const stsError = new Error('sts down')
      mocks.getServiceToken.mockRejectedValueOnce(stsError)
      const errorSpy = vi.fn()
      vi.spyOn(logger, 'error', 'get').mockReturnValue(errorSpy)

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
      expect(error.statusCode).toBe(503)
      expect(error.cause).toBe(stsError)
      expect(mocks.assertCallAllowed).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  describe('onResponse()', () => {
    test.each([
      [502, 'Bad Gateway'],
      [504, 'Gateway Time-out']
    ])(
      'it turns a failed spoke request into a %i Boom error naming the spoke, with a generic body and without logging, and records a failure',
      (statusCode, errorName) => {
        // Arrange
        const spoke = createSpoke()
        const errorSpy = vi.fn()
        vi.spyOn(logger, 'error', 'get').mockReturnValue(errorSpy)
        const upstreamError = Boom.boomify(new Error('Client request error'), {
          statusCode
        })

        // Act
        const result = spoke.route.handler.proxy.onResponse(
          upstreamError,
          undefined,
          { method: 'get', path: '/cattle/animals' },
          {}
        )

        // Assert
        expect(Boom.isBoom(result)).toBe(true)
        expect(result.output.statusCode).toBe(statusCode)
        expect(result.message).toBe(
          'Spoke lis-apps-cattle-home request failed: Client request error'
        )
        expect(result.cause).toBe(upstreamError)
        expect(result.output.payload).toEqual({
          statusCode,
          error: errorName,
          message: 'An internal server error occurred'
        })
        expect(errorSpy).not.toHaveBeenCalled()
        expect(mocks.recordFailure).toHaveBeenCalledTimes(1)
        expect(mocks.recordSuccess).not.toHaveBeenCalled()
      }
    )

    test('it defaults a failed spoke request without a status to 502 and records a failure', () => {
      // Arrange
      const spoke = createSpoke()
      const upstreamError = new Error('socket hang up')

      // Act
      const result = spoke.onResponse(upstreamError, undefined, {}, {})

      // Assert
      expect(result.output.statusCode).toBe(502)
      expect(result.cause).toBe(upstreamError)
      expect(mocks.recordFailure).toHaveBeenCalledTimes(1)
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

    test.each([200, 302, 404, 500])(
      'it passes a %i response through and records a success',
      (statusCode) => {
        // Arrange
        const spoke = createSpoke()
        const h = createToolkit()
        const response = { statusCode }

        // Act
        const result = spoke.onResponse(null, response, {}, h)

        // Assert
        expect(h.response).toHaveBeenCalledWith(response)
        expect(h.response.mock.results[0].value.code).toHaveBeenCalledWith(
          statusCode
        )
        expect(
          h.response.mock.results[0].value.passThrough
        ).toHaveBeenCalledWith(true)
        expect(result).toBe('passed through')
        expect(mocks.recordSuccess).toHaveBeenCalledTimes(1)
        expect(mocks.recordFailure).not.toHaveBeenCalled()
      }
    )
  })
})
