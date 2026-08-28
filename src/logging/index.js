/** @import { Logger } from 'pino' */
import hapiPino from 'hapi-pino'
import { TogglablePrettyStream } from './togglable-pretty-stream.js'
import { pino } from 'pino'
import { ecsFormat } from '@elastic/ecs-pino-format'
import { LogContextStore } from './log-context-store.js'

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
  #prettyStream = new TogglablePrettyStream({ sync: true })
  #contextStore
  #level = 'info'
  #enabled = true
  #format = 'ecs'
  #serviceName = process.env.SERVICE_NAME
  #serviceVersion = process.env.SERVICE_VERSION

  constructor() {
    this.#logger = pino(
      {
        ...ecsFormat(),
        redact: { paths: redactPaths, remove: true },
        level: 'info',
        nesting: true,
        mixin: this.#mixin.bind(this)
      },
      this.#prettyStream
    )
    this.#contextStore = new LogContextStore({ logger: this })
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

  /**
   * Request-scoped store for values that should enrich log lines - set via
   * context.set(key, value) (or context.set(key, value, true) to hash the
   * value with context.hashSecret) wherever they become known.
   *
   * @returns {LogContextStore}
   */
  get context() {
    return this.#contextStore
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

  /**
   * pino mixin() - merges every value set on context (excluding
   * correlation_id, which maps onto ECS's trace.id) into every log line, as
   * space-separated key=value pairs on ECS's tenant.message field.
   * @returns {object}
   */
  #mixin() {
    const mixinValues = {
      service: { name: this.#serviceName, version: this.#serviceVersion }
    }
    const correlationId = this.context.get('correlation_id')
    const contextValues = this.context.getAll()

    delete contextValues['correlation_id']

    if (correlationId) {
      mixinValues.trace = { id: correlationId }
    }

    const tenantMessage = Object.entries(contextValues)
      .toSorted(([a], [b]) => a - b)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')

    if (tenantMessage) {
      mixinValues.tenant = { message: tenantMessage }
    }

    return mixinValues
  }
}

export const logger = new Logger()
