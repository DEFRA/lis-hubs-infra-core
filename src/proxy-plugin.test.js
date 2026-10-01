import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { createProxyPlugin } from './proxy-plugin.js'
import { getServiceToken } from './service-token/issuer.js'

vi.mock('@defra/lis-hubs-infra-registry')
vi.mock('./service-token/issuer.js')

const mocks = {
  getModulesForHub: vi.mocked(getModulesForHub),
  getServiceToken: vi.mocked(getServiceToken)
}

describe('createProxyPlugin()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModulesForHub.mockReturnValue([
      { id: 'cattle-home', path: '/cattle', port: 3222 }
    ])
    mocks.getServiceToken.mockResolvedValue('service-token')
  })

  test.each([
    // Local proxying intentionally uses HTTP because the services run locally.
    ['local', 'http://localhost:3222'],
    // docker_compose reaches every service via the host's published ports -
    // there's no reliable compose service-name discovery to lean on instead.
    ['docker_compose', 'http://host.docker.internal:3222'],
    ['test', 'https://lis-apps-cattle-home.test.cdp-int.defra.cloud'],
    ['prod', 'https://lis-apps-cattle-home.prod.cdp-int.defra.cloud']
  ])('registers the %s proxy target', async (environment, expectedBaseUri) => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment,
      hubJwtCookieName: 'livestock_hub_jwt'
    })

    // Act
    await proxy.plugin.register(server)

    // Assert
    expect(server.register).toHaveBeenCalled()
    expect(mocks.getModulesForHub).toHaveBeenCalledWith('back-office')
    const route = server.route.mock.calls[0][0]
    expect(route).toMatchObject({ method: '*', path: '/cattle/{path*}' })
    expect(
      await route.handler.proxy.mapUri({
        params: { path: 'summary-data' },
        url: new URL('http://hub.test/cattle/summary-data'),
        headers: {
          authorization: 'Bearer hub-service-token',
          cookie: 'livestock_hub_jwt=hub.jwt.value'
        }
      })
    ).toEqual({
      uri: `${expectedBaseUri}/summary-data`,
      headers: {
        'x-forwarded-prefix': '/cattle',
        authorization: 'Bearer service-token',
        cookie: 'livestock_hub_jwt=hub.jwt.value'
      }
    })
    expect(
      await route.handler.proxy.mapUri({
        params: {},
        url: new URL('http://hub.test/cattle'),
        headers: {}
      })
    ).toEqual({
      uri: expectedBaseUri,
      headers: {
        'x-forwarded-prefix': '/cattle',
        authorization: 'Bearer service-token'
      }
    })
  })

  test('sends a service token for the target spoke in place of the inbound authorization', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt'
    })
    const request = {
      params: {},
      url: new URL('http://hub.test/cattle'),
      headers: { authorization: 'Bearer browser-token' }
    }

    // Act
    await proxy.plugin.register(server)
    const result =
      await server.route.mock.calls[0][0].handler.proxy.mapUri(request)

    // Assert
    expect(mocks.getServiceToken).toHaveBeenCalledWith('lis-apps-cattle-home')
    expect(result.headers.authorization).toBe('Bearer service-token')
  })

  test('rejects when the service token cannot be obtained', async () => {
    // Arrange
    mocks.getServiceToken.mockRejectedValue(new Error('sts down'))
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt'
    })
    await proxy.plugin.register(server)

    // Act
    let error
    try {
      await server.route.mock.calls[0][0].handler.proxy.mapUri({
        params: {},
        url: new URL('http://hub.test/cattle'),
        headers: {}
      })
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe('sts down')
  })

  test('forwards only the hub JWT cookie', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt'
    })
    const request = {
      params: { path: 'animals' },
      url: new URL('http://hub.test/cattle/animals'),
      headers: {
        cookie:
          'front-office-session=abc; livestock_hub_jwt=hub.jwt.value; other=1'
      }
    }

    // Act
    await proxy.plugin.register(server)
    const result =
      await server.route.mock.calls[0][0].handler.proxy.mapUri(request)

    // Assert
    expect(result.headers.cookie).toBe('livestock_hub_jwt=hub.jwt.value')
    expect(request.headers).toEqual({})
  })

  test('sends no cookie when there is no hub JWT cookie', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt'
    })
    const request = {
      params: {},
      url: new URL('http://hub.test/cattle'),
      headers: { cookie: 'front-office-session=abc' }
    }

    // Act
    await proxy.plugin.register(server)
    const result =
      await server.route.mock.calls[0][0].handler.proxy.mapUri(request)

    // Assert
    expect(result.headers).toEqual({
      'x-forwarded-prefix': '/cattle',
      authorization: 'Bearer service-token'
    })
    expect(request.headers).toEqual({})
  })

  test('requires the hub JWT cookie name', () => {
    // Arrange / Act
    let error
    try {
      createProxyPlugin({ hubId: 'back-office', environment: 'local' })
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe('hubJwtCookieName is required')
  })

  test('removes the inbound authorization header so passThrough cannot forward it', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt'
    })
    const request = {
      params: { path: 'animals' },
      url: new URL('http://hub.test/cattle/animals'),
      headers: { authorization: 'Bearer browser-token', accept: 'text/html' }
    }

    // Act
    await proxy.plugin.register(server)
    await server.route.mock.calls[0][0].handler.proxy.mapUri(request)

    // Assert
    expect(request.headers).toEqual({ accept: 'text/html' })
  })

  test('forwards the incoming query string to the proxied service', async () => {
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
    const route = server.route.mock.calls[0][0]
    expect(
      await route.handler.proxy.mapUri({
        params: { path: 'animals' },
        url: new URL(
          'http://hub.test/cattle/animals?sort=sex&direction=asc&page=1'
        ),
        headers: {}
      })
    ).toMatchObject({
      uri: 'http://localhost:3222/animals?sort=sex&direction=asc&page=1'
    })
  })

  test('rejects an unsupported environment', async () => {
    // Arrange
    const server = { route: vi.fn(), register: vi.fn() }
    const proxy = createProxyPlugin({
      hubId: 'back-office',
      environment: 'unknown',
      hubJwtCookieName: 'livestock_hub_jwt'
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
    expect(error.message).toBe('Unsupported environment: unknown')
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
      environment: 'local',
      hubJwtCookieName: 'livestock_hub_jwt'
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
