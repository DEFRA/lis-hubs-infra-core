import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { createProxyPlugin } from './proxy-plugin.js'
import { getHeaders } from './request-context.js'

vi.mock('@defra/lis-hubs-infra-registry')
vi.mock('./request-context.js')

const mocks = {
  getModulesForHub: vi.mocked(getModulesForHub),
  getHeaders: vi.mocked(getHeaders)
}

describe('createProxyPlugin()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getHeaders.mockReturnValue({})
    mocks.getModulesForHub.mockReturnValue([
      { id: 'cattle-home', path: '/cattle', port: 3222 }
    ])
  })

  test.each([
    // Local proxying intentionally uses HTTP because the services run locally.
    ['local', 'http://localhost:3222'],
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    ['docker_compose', 'http://cattle-home:3222'],
    ['test', 'https://lis-apps-cattle-home.test.cdp-int.defra.cloud'],
    ['prod', 'https://lis-apps-cattle-home.prod.cdp-int.defra.cloud']
  ])('registers the %s proxy target', async (environment, expectedBaseUri) => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({ hubId: 'back-office', environment })

    // Act
    await proxy.plugin.register(server)

    // Assert
    expect(server.register).toHaveBeenCalled()
    expect(mocks.getModulesForHub).toHaveBeenCalledWith('back-office')
    const route = server.route.mock.calls[0][0]
    expect(route).toMatchObject({ method: '*', path: '/cattle/{path*}' })
    expect(
      route.handler.proxy.mapUri({
        params: { path: 'summary-data' },
        headers: { cookie: 'session=abc' }
      })
    ).toEqual({
      uri: `${expectedBaseUri}/summary-data`,
      headers: {
        'x-forwarded-prefix': '/cattle',
        cookie: 'session=abc',
        'x-lis-origin-service': 'back-office',
        'x-lis-cph-number': '',
        'x-lis-animal-id': '',
        'x-lis-user-id': ''
      }
    })
    expect(route.handler.proxy.mapUri({ params: {}, headers: {} })).toEqual({
      uri: expectedBaseUri,
      headers: {
        'x-forwarded-prefix': '/cattle',
        'x-lis-origin-service': 'back-office',
        'x-lis-cph-number': '',
        'x-lis-animal-id': '',
        'x-lis-user-id': ''
      }
    })
  })

  test('mapUri defaults x-lis-origin-service to the hub id when nothing is set in the request context', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'front-office',
      environment: 'local'
    })
    await proxy.plugin.register(server)
    const { mapUri } = server.route.mock.calls[0][0].handler.proxy

    // Act
    const headers = mapUri({ params: {}, headers: {} }).headers

    // Assert
    expect(headers['x-lis-origin-service']).toBe('front-office')
  })

  test('mapUri forwards cph, animal_id, user_id and an explicitly set origin_service from the request context', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'front-office',
      environment: 'local'
    })
    await proxy.plugin.register(server)
    const { mapUri } = server.route.mock.calls[0][0].handler.proxy
    mocks.getHeaders.mockReturnValue({
      'x-lis-origin-service': 'front-office',
      'x-lis-cph-number': '12/345/6789',
      'x-lis-animal-id': 'UK123456789012',
      'x-lis-user-id': 'hashed-user-1'
    })

    // Act
    const headers = mapUri({ params: {}, headers: {} }).headers

    // Assert
    expect(headers).toMatchObject({
      'x-lis-origin-service': 'front-office',
      'x-lis-cph-number': '12/345/6789',
      'x-lis-animal-id': 'UK123456789012',
      'x-lis-user-id': 'hashed-user-1'
    })
  })

  test('mapUri blanks cph, animal_id and user_id when they are not set in the request context', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'front-office',
      environment: 'local'
    })
    await proxy.plugin.register(server)
    const { mapUri } = server.route.mock.calls[0][0].handler.proxy

    // Act
    const headers = mapUri({ params: {}, headers: {} }).headers

    // Assert
    expect(headers['x-lis-cph-number']).toBe('')
    expect(headers['x-lis-animal-id']).toBe('')
    expect(headers['x-lis-user-id']).toBe('')
  })

  test('mapUri always returns every x-lis-* header explicitly, so a client-supplied header on the original request cannot survive h2o2 passThrough merge untouched', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'front-office',
      environment: 'local'
    })
    await proxy.plugin.register(server)
    const { mapUri } = server.route.mock.calls[0][0].handler.proxy

    // Act
    const { headers } = mapUri({ params: {}, headers: {} })

    // Assert
    expect(Object.keys(headers).sort()).toEqual(
      [
        'x-forwarded-prefix',
        'x-lis-animal-id',
        'x-lis-cph-number',
        'x-lis-origin-service',
        'x-lis-user-id'
      ].sort()
    )
  })

  test('rejects an unsupported environment', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'unknown'
    })

    // Act
    let error
    try {
      await proxy.plugin.register(server)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeDefined()
    expect(error.message).toBe('Unhandled environment: unknown')
  })

  test('sorts modules with the longest path first so a shorter prefix does not swallow a longer one', async () => {
    // Arrange
    mocks.getModulesForHub.mockReturnValue([
      { id: 'cattle-home', path: '/cattle', port: 3221 },
      { id: 'cattle-register', path: '/cattle/register', port: 3201 }
    ])
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'front-office',
      environment: 'local'
    })

    // Act
    await proxy.plugin.register(server)

    // Assert
    const registeredPaths = server.route.mock.calls.map(([{ path }]) => path)
    expect(registeredPaths).toEqual([
      '/cattle/register/{path*}',
      '/cattle/{path*}'
    ])
  })
})
