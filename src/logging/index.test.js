import { describe, expect, test, vi } from 'vitest'

import { logger } from './index.js'

describe('Logger', () => {
  describe('serviceName', () => {
    test('it defaults to process.env.SERVICE_NAME', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      // Assert
      expect(freshLogging.serviceName).toBe(process.env.SERVICE_NAME)
    })

    test('it is settable and surfaces on log lines', () => {
      // Arrange
      const freshLogging = new logger.constructor()
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)

      // Act
      freshLogging.serviceName = 'Home for Cattle'
      freshLogging.info('test message')
      const [logLine] = writeSpy.mock.calls[0]
      writeSpy.mockRestore()

      // Assert
      expect(JSON.parse(logLine.toString()).service.name).toBe(
        'Home for Cattle'
      )
    })
  })

  describe('serviceVersion', () => {
    test('it defaults to process.env.SERVICE_VERSION', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      // Assert
      expect(freshLogging.serviceVersion).toBe(process.env.SERVICE_VERSION)
    })

    test('it is settable and surfaces on log lines', () => {
      // Arrange
      const freshLogging = new logger.constructor()
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)

      // Act
      freshLogging.serviceVersion = '1.2.3'
      freshLogging.info('test message')
      const [logLine] = writeSpy.mock.calls[0]
      writeSpy.mockRestore()

      // Assert
      expect(JSON.parse(logLine.toString()).service.version).toBe('1.2.3')
    })
  })

  describe('redact', () => {
    test('it removes authorization, cookie and res.headers from logged output', () => {
      // Arrange
      const freshLogging = new logger.constructor()
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)

      // Act
      freshLogging.info({
        req: {
          headers: {
            authorization: 'Bearer secret-token',
            cookie: 'session=secret-session'
          }
        },
        res: { headers: { 'set-cookie': 'session=secret-session' } }
      })
      const [logLine] = writeSpy.mock.calls[0]
      writeSpy.mockRestore()

      // Assert
      expect(logLine.toString()).not.toContain('secret-token')
      expect(logLine.toString()).not.toContain('secret-session')
    })
  })
  describe.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])(
    '%s',
    (level) => {
      test('it is callable without configure() being called first', () => {
        // Arrange
        const freshLogging = new logger.constructor()

        // Act
        // Assert
        expect(typeof freshLogging[level]).toBe('function')
        expect(() => freshLogging[level]('test message')).not.toThrow()
      })
    }
  )

  describe('hapiPlugin', () => {
    test('it wraps the currently active logger for request logging', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      const plugin = freshLogging.hapiPlugin

      // Assert
      expect(typeof plugin.options.instance.info).toBe('function')
    })

    test('it ignores health, public and favicon paths by default', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      const plugin = freshLogging.hapiPlugin

      // Assert
      expect(plugin.options.ignoreFunc(null, { path: '/health' })).toBe(true)
      expect(plugin.options.ignoreFunc(null, { path: '/profile' })).toBe(false)
    })
  })

  describe('level', () => {
    test('it defaults to info', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      // Assert
      expect(freshLogging.level).toBe('info')
    })

    test('it sets the level on the active logger', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      freshLogging.level = 'debug'

      // Assert
      expect(freshLogging.level).toBe('debug')
      expect(freshLogging.hapiPlugin.options.instance.level).toBe('debug')
    })

    test('it sets the level on every format variant, not just the active one', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      freshLogging.level = 'warn'
      freshLogging.format = 'pretty-print'

      // Assert
      expect(freshLogging.hapiPlugin.options.instance.level).toBe('warn')
    })
  })

  describe('enabled', () => {
    test('it defaults to true', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      // Assert
      expect(freshLogging.enabled).toBe(true)
    })

    test('it silences the logger when set to false', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      freshLogging.enabled = false

      // Assert
      expect(freshLogging.hapiPlugin.options.instance.level).toBe('silent')
    })

    test('it restores the configured level when set back to true', () => {
      // Arrange
      const freshLogging = new logger.constructor()
      freshLogging.level = 'debug'
      freshLogging.enabled = false

      // Act
      freshLogging.enabled = true

      // Assert
      expect(freshLogging.hapiPlugin.options.instance.level).toBe('debug')
    })
  })

  describe('format', () => {
    test('it defaults to ecs', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      // Assert
      expect(freshLogging.format).toBe('ecs')
    })

    test('it switches which logger is active', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      freshLogging.format = 'pretty-print'

      // Assert
      expect(freshLogging.format).toBe('pretty-print')
    })

    test('it ignores an unknown format, leaving the current one active', () => {
      // Arrange
      const freshLogging = new logger.constructor()

      // Act
      freshLogging.format = 'not-a-real-format'

      // Assert
      expect(freshLogging.format).toBe('ecs')
    })
  })
})
