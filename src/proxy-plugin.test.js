import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { createProxyPlugin } from './proxy-plugin.js'

vi.mock('@defra/lis-hubs-infra-registry')

const mocks = {
  getModulesForHub: vi.mocked(getModulesForHub)
}

describe('createProxyPlugin()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        cookie: 'session=abc'
      }
    })
    expect(route.handler.proxy.mapUri({ params: {}, headers: {} })).toEqual({
      uri: expectedBaseUri,
      headers: {
        'x-forwarded-prefix': '/cattle'
      }
    })
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
