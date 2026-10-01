import Wreck from '@hapi/wreck'

import * as requestContext from './request-context.js'
import { getServiceBaseUrl } from './get-service-base-url.js'
import { getServiceToken } from './service-token/issuer.js'

const BAD_REQUEST = 400
const UNPROCESSABLE_ENTITY = 422
const SERVICE_UNAVAILABLE = 503
const DEFAULT_TIMEOUT_MS = 3000

const ABSOLUTE_URL_PATTERN = /^([a-z][a-z0-9+.-]*:|\/\/)/i

export class ServiceTokenError extends Error {
  name = 'ServiceTokenError'
  statusCode = SERVICE_UNAVAILABLE
}

/**
 * A generic Wreck wrapper for a BE4FE or other upstream service, shared
 * across spokes and hubs. It resolves its own baseUrl via getServiceBaseUrl,
 * so a consumer only supplies the environment and the target service's name.
 * Subclass it and add named methods that call
 * _get()/_post()/_put()/_patch()/_delete() with a path.
 */
export class BaseClient {
  /** @protected */
  _baseUrl

  /** @protected */
  _serviceName

  /** @protected */
  _apiKey

  /** @protected */
  _timeout

  /**
   * @param {{ environment: string, serviceName: string, port?: number, apiKey?: string, timeout?: number }} options timeout is in milliseconds, default 3000, and applies to each of the response and body reads
   */
  constructor({
    environment,
    serviceName,
    port,
    apiKey,
    timeout = DEFAULT_TIMEOUT_MS
  }) {
    this._baseUrl = getServiceBaseUrl(environment, serviceName, port).origin
    this._serviceName = serviceName
    this._apiKey = apiKey
    this._timeout = timeout
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _get(path, options) {
    return this._request('GET', path, options)
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _post(path, options) {
    return this._request('POST', path, options)
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _put(path, options) {
    return this._request('PUT', path, options)
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _patch(path, options) {
    return this._request('PATCH', path, options)
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _delete(path, options) {
    return this._request('DELETE', path, options)
  }

  /**
   * @protected
   * @param {object} [options] caller-supplied Wreck request options
   * @returns {Promise<object>} Wreck request options with baseUrl/json/timeout/headers applied
   */
  async _buildOptions(options = {}) {
    return {
      json: true,
      ...options,
      baseUrl: this._baseUrl,
      timeout: this._timeout,
      headers: await this._buildHeaders(options.headers)
    }
  }

  /**
   * @protected
   * @param {object} [callerHeaders] headers supplied on this call
   * @returns {Promise<object>} correlation, api key, caller and service token headers merged
   */
  async _buildHeaders(callerHeaders = {}) {
    const headers = { ...requestContext.getHeaders() }
    let authorizationToken
    try {
      authorizationToken = await getServiceToken(this._serviceName)
    } catch (cause) {
      throw new ServiceTokenError(
        `Failed to get a service token for ${this._serviceName}`,
        { cause }
      )
    }

    headers['authorization'] = `Bearer ${authorizationToken}`

    if (this._apiKey) {
      headers['x-api-key'] = this._apiKey
    }

    for (const [key, value] of Object.entries(callerHeaders)) {
      if (
        key.toLowerCase() !== 'authorization' &&
        key.toLowerCase() !== 'x-api-key'
      ) {
        headers[key] = value
      }
    }

    return headers
  }

  /**
   * @protected
   * @param {string} method HTTP method
   * @param {string} path Path relative to baseUrl
   * @param {object} [callerOptions] caller-supplied Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  async _request(method, path, callerOptions) {
    // An absolute URL would send the service token to a host other than this
    // client's own service.
    if (ABSOLUTE_URL_PATTERN.test(path)) {
      throw new Error(
        'BaseClient paths must be relative to the service base URL'
      )
    }

    let options
    let res

    try {
      options = await this._buildOptions(callerOptions)
      res = await Wreck.request(method, path, options)
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw error
      }
      throw this.#parseError(error.output?.statusCode, error.data?.payload)
    }

    let payload

    try {
      payload = await Wreck.read(res, options)
    } catch {
      throw this.#parseError(res.statusCode)
    }

    if (res.statusCode >= BAD_REQUEST) {
      throw this.#parseError(res.statusCode, payload)
    }

    return { res, payload }
  }

  #parseError(statusCode, payload) {
    let message

    if (payload?.error?.code) {
      message = `${payload.error.code} - ${payload.error.message}`
    } else if (payload?.detail || payload?.title) {
      message = `${payload.status} - ${payload.detail || payload.title}`
    } else if (statusCode === UNPROCESSABLE_ENTITY) {
      message = 'Validation failed'
    } else {
      message = `Request failed - ${statusCode}`
    }

    const error = new Error(message)
    error.statusCode = statusCode
    return error
  }
}
