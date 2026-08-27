/** @import { Logger } from 'pino' */
import hapiPino from 'hapi-pino'
import { TogglablePrettyStream } from './togglable-pretty-stream.js'
import { pino } from 'pino'
import { ecsFormat } from '@elastic/ecs-pino-format'
import { mixin } from './mixin.js'

const defaultIgnorePath = (_, request) =>
  request.path.startsWith('/public') ||
  request.path === '/health' ||
  request.path === '/favicon.ico'

const validFormats = new Set(['ecs', 'pretty-print'])

// Standardised, non-configurable across every consumer - these headers
// must never reach logs.
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers'
]

class Logger {
  #logger
  #prettyStream
  #level = 'info'
  #enabled = true
  #format = 'ecs'
  #serviceName = process.env.SERVICE_NAME
  #serviceVersion = process.env.SERVICE_VERSION

  constructor() {
    this.#prettyStream = new TogglablePrettyStream({ sync: true })
    this.#logger = pino(
      {
        ...ecsFormat(),
        redact: { paths: redactPaths, remove: true },
        level: 'info',
        nesting: true,
        mixin: () => ({
          ...mixin(),
          service: { name: this.#serviceName, version: this.#serviceVersion }
        })
      },
      this.#prettyStream
    )
  }

  set serviceName(name) {
    this.#serviceName = name
  }

  get serviceName() {
    return this.#serviceName
  }

  set serviceVersion(version) {
    this.#serviceVersion = version
  }

  get serviceVersion() {
    return this.#serviceVersion
  }

  set level(level) {
    this.#level = level
    this.#logger.level = this.#enabled ? this.#level : 'silent'
  }

  get level() {
    return this.#level
  }

  set enabled(bool) {
    this.#enabled = bool
    this.#logger.level = bool ? this.#level : 'silent'
  }

  get enabled() {
    return this.#enabled
  }

  set format(str) {
    if (validFormats.has(str)) {
      this.#format = str
      this.#prettyStream.enabled = str === 'pretty-print'
    }
  }

  get format() {
    return this.#format
  }

  get fatal() {
    return this.#logger.fatal.bind(this.#logger)
  }

  get error() {
    return this.#logger.error.bind(this.#logger)
  }

  get warn() {
    return this.#logger.warn.bind(this.#logger)
  }

  get info() {
    return this.#logger.info.bind(this.#logger)
  }

  get debug() {
    return this.#logger.debug.bind(this.#logger)
  }

  get trace() {
    return this.#logger.trace.bind(this.#logger)
  }

  get hapiPlugin() {
    return {
      plugin: hapiPino,
      options: {
        instance: this.#logger,
        ignoreFunc: defaultIgnorePath
      }
    }
  }
}

export const logger = new Logger()
