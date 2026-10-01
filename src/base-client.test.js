import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import Wreck from '@hapi/wreck'

import * as requestContext from './request-context.js'
import { getServiceBaseUrl } from './get-service-base-url.js'
import { getServiceToken } from './service-token/issuer.js'
import { BaseClient, ServiceTokenError } from './base-client.js'

vi.mock('./request-context.js')
vi.mock('./get-service-base-url.js')
vi.mock('./service-token/issuer.js')

const mocks = {
  requestContextGetHeaders: vi.mocked(requestContext.getHeaders),
  getServiceBaseUrl: vi.mocked(getServiceBaseUrl),
  getServiceToken: vi.mocked(getServiceToken)
}

function createClient(options = {}) {
  return new BaseClient({
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
  vi.restoreAllMocks()
})

describe('BaseClient constructor', () => {
  test('it resolves its baseUrl via getServiceBaseUrl', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/users/user-1/cphs')

    // Assert
    expect(mocks.getServiceBaseUrl).toHaveBeenCalledWith(
      'local',
      'lis-be4fe-cattle-home',
      8085
    )
    expect(Wreck.request.mock.calls[0][2].baseUrl).toBe('http://localhost:8085')
  })
})

describe('request verbs', () => {
  test.each([
    ['_get', 'GET'],
    ['_post', 'POST'],
    ['_put', 'PUT'],
    ['_patch', 'PATCH'],
    ['_delete', 'DELETE']
  ])(
    'it sends %s requests via Wreck.request with the correlation and service token headers',
    async (method, httpMethod) => {
      // Arrange
      const client = createClient({ timeout: 5000 })
      const res = { statusCode: 200 }
      const request = vi.spyOn(Wreck, 'request').mockResolvedValue(res)
      const read = vi.spyOn(Wreck, 'read').mockResolvedValue({ data: [] })

      // Act
      const result = await client[method]('api/users/user-1/cphs')

      // Assert
      expect(request).toHaveBeenCalledTimes(1)
      const [calledMethod, path, options] = request.mock.calls[0]
      expect(calledMethod).toBe(httpMethod)
      expect(path).toBe('api/users/user-1/cphs')
      expect(options.baseUrl).toBe('http://localhost:8085')
      expect(options.json).toBe(true)
      expect(options.timeout).toBe(5000)
      expect(options.headers).toEqual({
        'x-correlation-id': 'correlation-1',
        'x-cdp-request-id': 'correlation-1',
        authorization: 'Bearer service-token'
      })
      expect(read).toHaveBeenCalledWith(res, options)
      expect(result).toEqual({ res, payload: { data: [] } })
    }
  )

  test('it sends the api key in the x-api-key header', async () => {
    // Arrange
    const client = createClient({ apiKey: 'test-api-key' })
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/users/user-1/cphs')

    // Assert
    expect(Wreck.request.mock.calls[0][2].headers).toEqual({
      'x-correlation-id': 'correlation-1',
      'x-cdp-request-id': 'correlation-1',
      'x-api-key': 'test-api-key',
      authorization: 'Bearer service-token'
    })
  })

  test('it times requests out after 3 seconds by default', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/users/user-1/cphs')

    // Assert
    expect(Wreck.request.mock.calls[0][2].timeout).toBe(3000)
  })

  test.each([
    ['without a configured api key', undefined],
    ['over a configured api key', 'test-api-key']
  ])(
    'it never sends a caller-supplied x-api-key, in any casing, %s',
    async (_, apiKey) => {
      // Arrange
      const client = createClient({ apiKey })
      vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
      vi.spyOn(Wreck, 'read').mockResolvedValue({})

      // Act
      await client._get('api/users/user-1/cphs', {
        headers: { 'X-Api-Key': 'caller-key', 'x-api-key': 'caller-key' }
      })

      // Assert
      const { headers } = Wreck.request.mock.calls[0][2]
      expect(headers).not.toHaveProperty('X-Api-Key')
      expect(headers['x-api-key']).toBe(apiKey)
    }
  )

  test('it lets per-call headers override the defaults', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/cattle/UK123', {
      headers: { 'x-correlation-id': 'override-id' }
    })

    // Assert
    expect(Wreck.request.mock.calls[0][2].headers['x-correlation-id']).toBe(
      'override-id'
    )
  })
})

describe('service token', () => {
  test('it requests the token for the target service as the audience', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/users/user-1/cphs')

    // Assert
    expect(mocks.getServiceToken).toHaveBeenCalledWith('lis-be4fe-cattle-home')
    expect(Wreck.request.mock.calls[0][2].headers.authorization).toBe(
      'Bearer service-token'
    )
  })

  test('it applies correlation, then caller headers, with the api key and service token taking precedence', async () => {
    // Arrange
    mocks.requestContextGetHeaders.mockReturnValue({
      authorization: 'Bearer correlation',
      'x-api-key': 'correlation',
      'x-correlation-id': 'correlation'
    })
    const client = createClient({ apiKey: 'test-api-key' })
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/cattle/UK123')
    await client._get('api/cattle/UK123', {
      headers: {
        authorization: 'Bearer caller',
        'x-api-key': 'caller',
        'x-correlation-id': 'caller'
      }
    })

    // Assert
    const [first, second] = Wreck.request.mock.calls.map(
      ([, , options]) => options.headers
    )
    expect(first).toEqual({
      authorization: 'Bearer service-token',
      'x-api-key': 'test-api-key',
      'x-correlation-id': 'correlation'
    })
    expect(second).toEqual({
      authorization: 'Bearer service-token',
      'x-api-key': 'test-api-key',
      'x-correlation-id': 'caller'
    })
  })

  test('it drops a caller authorization header in any casing', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/cattle/UK123', {
      headers: { Authorization: 'Bearer caller' }
    })

    // Assert
    const { headers } = Wreck.request.mock.calls[0][2]
    expect(headers.authorization).toBe('Bearer service-token')
    expect(headers).not.toHaveProperty('Authorization')
  })

  test('it rejects without calling Wreck when the token cannot be obtained', async () => {
    // Arrange
    mocks.getServiceToken.mockRejectedValue(new Error('sts down'))
    const client = createClient()
    const request = vi.spyOn(Wreck, 'request')

    // Act
    let error
    try {
      await client._get('api/users/user-1/cphs')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(ServiceTokenError)
    expect(error.name).toBe('ServiceTokenError')
    expect(error.statusCode).toBe(503)
    expect(error.message).toBe(
      'Failed to get a service token for lis-be4fe-cattle-home'
    )
    expect(error.cause.message).toBe('sts down')
    expect(request).not.toHaveBeenCalled()
  })

  test('it ignores a caller-supplied baseUrl', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/cattle/UK123', { baseUrl: 'https://evil.example' })

    // Assert
    expect(Wreck.request.mock.calls[0][2].baseUrl).toBe('http://localhost:8085')
  })

  test.each([['https://evil.example/steal'], ['//evil.example/steal']])(
    'it rejects the absolute path %s without fetching a token or calling Wreck',
    async (path) => {
      // Arrange
      mocks.getServiceToken.mockClear()
      const client = createClient()
      const request = vi.spyOn(Wreck, 'request')

      // Act
      let error
      try {
        await client._get(path)
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe(
        'BaseClient paths must be relative to the service base URL'
      )
      expect(mocks.getServiceToken).not.toHaveBeenCalled()
      expect(request).not.toHaveBeenCalled()
    }
  )
})

describe('error handling', () => {
  test('it throws using the error payload when the response is non-2xx', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 404 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({
      error: { code: 'not_found', message: 'CPH not found' }
    })

    // Act
    let result, error
    try {
      result = await client._get('api/cphs/missing/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(result).not.toBeDefined()
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('not_found - CPH not found')
    expect(error.statusCode).toBe(404)
  })

  test('it throws using the ProblemDetails payload when the response is non-2xx', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 404 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({
      status: 404,
      title: 'Not Found',
      detail: 'CPH not found'
    })

    // Act
    let error
    try {
      await client._get('api/cphs/missing/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('404 - CPH not found')
  })

  test('it throws a generic validation error for a 422 response', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 422 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({
      PropertyName: ['must not be empty']
    })

    // Act
    let error
    try {
      await client._post('api/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Validation failed')
  })

  test('it falls back to a status-only message for an unrecognised error payload', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 503 })
    vi.spyOn(Wreck, 'read').mockResolvedValue(null)

    // Act
    let error
    try {
      await client._get('api/cphs/missing/cattle')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Request failed - 503')
  })

  test('it throws when Wreck.request itself throws', async () => {
    // Arrange
    const client = createClient()
    const wreckError = new Error('socket hang up')
    wreckError.output = { statusCode: 503 }
    wreckError.data = { payload: null }
    vi.spyOn(Wreck, 'request').mockRejectedValue(wreckError)

    // Act
    let error
    try {
      await client._get('api/users/user-1/cphs')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Request failed - 503')
  })

  test('it throws when the response body cannot be read', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockRejectedValue(new Error('Invalid JSON'))

    // Act
    let error
    try {
      await client._get('api/users/user-1/cphs')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Request failed - 200')
  })
})
