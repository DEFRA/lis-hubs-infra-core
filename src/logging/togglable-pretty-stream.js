/** @import { DestinationStream } from 'pino' */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pinoPretty = require('pino-pretty')

/**
 * A pino destination stream that can be toggled at runtime between passing
 * ECS JSON lines through unchanged and rendering them via pino-pretty -
 * avoids needing a second pino instance just to get human-readable output.
 * @implements {DestinationStream}
 */
export class TogglablePrettyStream {
  #pretty
  enabled = false

  /**
   * @param {object} options - Passed straight through to pino-pretty.
   */
  constructor(options) {
    this.#pretty = pinoPretty(options)
  }

  /**
   * @param {string} msg
   */
  write(msg) {
    if (this.enabled) {
      this.#pretty.write(msg)
    } else {
      process.stdout.write(msg)
    }
  }
}
