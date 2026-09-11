import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import Wreck from '@hapi/wreck'

import * as requestContext from './request-context.js'
import { getServiceBaseUrl } from './get-service-base-url.js'
import { BaseClient } from './base-client.js'

vi.mock('./request-context.js')
vi.mock('./get-service-base-url.js')

const mocks = {
  requestContextGetHeaders: vi.mocked(requestContext.getHeaders),
  getServiceBaseUrl: vi.mocked(getServiceBaseUrl)
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
    'it sends %s requests via Wreck.request with the api key and correlation headers',
    async (method, httpMethod) => {
      // Arrange
      const client = createClient({
        apiKey: 'test-api-key',
        apiKeyHeader: 'x-api-key',
        timeout: 5000
      })
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
        'x-api-key': 'test-api-key'
      })
      expect(read).toHaveBeenCalledWith(res, options)
      expect(result).toEqual({ res, payload: { data: [] } })
    }
  )

  test('it omits the api key header when no api key is configured', async () => {
    // Arrange
    const client = createClient()
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({ data: [] })

    // Act
    await client._get('api/users/user-1/cphs')

    // Assert
    expect(Wreck.request.mock.calls[0][2].headers).toEqual({
      'x-correlation-id': 'correlation-1',
      'x-cdp-request-id': 'correlation-1'
    })
  })

  test('it lets per-call headers override the defaults', async () => {
    // Arrange
    const client = createClient({
      apiKey: 'test-api-key',
      apiKeyHeader: 'x-api-key'
    })
    vi.spyOn(Wreck, 'request').mockResolvedValue({ statusCode: 200 })
    vi.spyOn(Wreck, 'read').mockResolvedValue({})

    // Act
    await client._get('api/cattle/UK123', {
      headers: { 'x-api-key': 'override-key' }
    })

    // Assert
    expect(Wreck.request.mock.calls[0][2].headers['x-api-key']).toBe(
      'override-key'
    )
  })
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
