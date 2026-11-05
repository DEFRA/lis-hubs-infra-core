import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

import { getServiceToken } from './service-token/issuer.js'
import { CSRF_TOKEN_HEADER, JWT_ASSERTION_HEADER, Spoke } from './spoke.js'

vi.mock('./service-token/issuer.js')
vi.mock('./circuit-breaker.js')

const mocks = {
  getServiceToken: vi.mocked(getServiceToken)
}

function createSpoke() {
  return new Spoke({
    moduleName: 'cattle-home',
    mounts: ['/holdings/{cph*3}/cattle'],
    port: 3222,
    environment: 'local',
    timeout: 30000,
    getUserToken: () => 'hub.jwt.value'
  })
}

function createRequest({ headers = {}, plugins = {} } = {}) {
  const url = new URL('http://hub.test/holdings/12/345/0001/cattle/animals')
  return { path: url.pathname, url, headers, plugins }
}

describe('Spoke CSRF handling', () => {
  beforeAll(() => {
    mocks.getServiceToken.mockResolvedValue('service-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('it keeps the origin check on its routes and leaves the token to the spoke', () => {
    // Act
    const { routes } = createSpoke()

    // Assert
    expect(routes[0].options.plugins).toEqual({
      'lis-csrf': { token: false }
    })
  })

  test('it sends the session CSRF token in the header', async () => {
    // Arrange
    const spoke = createSpoke()
    const request = createRequest({
      plugins: { 'lis-csrf': { token: 'csrf-token' } }
    })

    // Act
    const mapped = await spoke.mapUri(request)

    // Assert
    expect(mapped.headers).toEqual({
      authorization: 'Bearer service-token',
      [JWT_ASSERTION_HEADER]: 'hub.jwt.value',
      [CSRF_TOKEN_HEADER]: 'csrf-token'
    })
  })

  test('it drops a CSRF token header sent by the browser and uses the session token', async () => {
    // Arrange
    const spoke = createSpoke()
    const request = createRequest({
      headers: { [CSRF_TOKEN_HEADER]: 'evil', accept: 'text/html' },
      plugins: { 'lis-csrf': { token: 'csrf-token' } }
    })

    // Act
    const mapped = await spoke.mapUri(request)

    // Assert
    expect(mapped.headers[CSRF_TOKEN_HEADER]).toBe('csrf-token')
    expect(request.headers).toEqual({ accept: 'text/html' })
  })

  test.each([
    ['no CSRF plugin state', {}],
    ['no token', { 'lis-csrf': {} }],
    ['an empty token', { 'lis-csrf': { token: '' } }],
    ['a token that is not a string', { 'lis-csrf': { token: 42 } }]
  ])(
    'it drops a CSRF token header sent by the browser and sends none when there is %s',
    async (_description, plugins) => {
      // Arrange
      const spoke = createSpoke()
      const request = createRequest({
        headers: { [CSRF_TOKEN_HEADER]: 'evil' },
        plugins
      })

      // Act
      const mapped = await spoke.mapUri(request)

      // Assert
      expect(mapped.headers).toEqual({
        authorization: 'Bearer service-token',
        [JWT_ASSERTION_HEADER]: 'hub.jwt.value'
      })
      expect(request.headers).toEqual({})
    }
  )
})
