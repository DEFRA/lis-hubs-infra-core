import { describe, expect, test } from 'vitest'

import { getServiceBaseUrl } from './get-service-base-url.js'

describe('getServiceBaseUrl()', () => {
  test('resolves to localhost with the given port for local', () => {
    // Arrange
    const environment = 'local'
    const serviceName = 'lis-apps-cattle-home'
    const localPort = 3221

    // Act
    const baseUrl = getServiceBaseUrl(environment, serviceName, localPort)

    // Assert
    expect(baseUrl.href).toBe('http://localhost:3221/')
  })

  test('resolves to host.docker.internal with the given port for docker_compose', () => {
    // Arrange
    const environment = 'docker_compose'
    const serviceName = 'lis-apps-cattle-home'
    const localPort = 3221

    // Act
    const baseUrl = getServiceBaseUrl(environment, serviceName, localPort)

    // Assert
    expect(baseUrl.href).toBe('http://host.docker.internal:3221/')
  })

  test.each([
    ['dev', 'https://lis-apps-cattle-home.dev.cdp-int.defra.cloud/'],
    ['test', 'https://lis-apps-cattle-home.test.cdp-int.defra.cloud/'],
    ['ext-test', 'https://lis-apps-cattle-home.ext-test.cdp-int.defra.cloud/'],
    [
      'perf-test',
      'https://lis-apps-cattle-home.perf-test.cdp-int.defra.cloud/'
    ],
    ['prod', 'https://lis-apps-cattle-home.prod.cdp-int.defra.cloud/']
  ])('resolves to the CDP hostname for %s', (environment, expectedHref) => {
    // Arrange
    const serviceName = 'lis-apps-cattle-home'
    const localPort = 3221

    // Act
    const baseUrl = getServiceBaseUrl(environment, serviceName, localPort)

    // Assert
    expect(baseUrl.href).toBe(expectedHref)
  })

  test.each(['local', 'docker_compose'])(
    'throws when localPort is missing for %s',
    (environment) => {
      // Arrange
      const serviceName = 'lis-apps-cattle-home'

      // Act
      let result, error
      try {
        result = getServiceBaseUrl(environment, serviceName)
      } catch (e) {
        error = e
      }

      // Assert
      expect(result).not.toBeDefined()
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe(
        `getServiceBaseUrl requires a localPort for the ${environment} environment`
      )
    }
  )

  test('throws for an unsupported environment', () => {
    // Arrange
    const environment = 'unknown'
    const serviceName = 'lis-apps-cattle-home'
    const localPort = 3221

    // Act
    let result, error
    try {
      result = getServiceBaseUrl(environment, serviceName, localPort)
    } catch (e) {
      error = e
    }

    // Assert
    expect(result).not.toBeDefined()
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Unsupported environment: unknown')
  })
})
