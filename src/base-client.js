import Wreck from '@hapi/wreck'

import * as requestContext from './request-context.js'
import { getServiceBaseUrl } from './get-service-base-url.js'

const BAD_REQUEST = 400
const UNPROCESSABLE_ENTITY = 422

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
  _apiKey

  /** @protected */
  _apiKeyHeader

  /** @protected */
  _timeout

  /**
   * @param {{ environment: string, serviceName: string, port?: number, apiKey?: string, apiKeyHeader?: string, timeout?: number }} options
   */
  constructor({
    environment,
    serviceName,
    port,
    apiKey,
    apiKeyHeader,
    timeout
  }) {
    this._baseUrl = getServiceBaseUrl(environment, serviceName, port).origin
    this._apiKey = apiKey
    this._apiKeyHeader = apiKeyHeader
    this._timeout = timeout
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _get(path, options) {
    return this._request('GET', path, this._buildOptions(options))
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _post(path, options) {
    return this._request('POST', path, this._buildOptions(options))
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _put(path, options) {
    return this._request('PUT', path, this._buildOptions(options))
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _patch(path, options) {
    return this._request('PATCH', path, this._buildOptions(options))
  }

  /**
   * @protected
   * @param {string} path Path relative to baseUrl
   * @param {object} [options] Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  _delete(path, options) {
    return this._request('DELETE', path, this._buildOptions(options))
  }

  /**
   * @protected
   * @param {object} [options] caller-supplied Wreck request options
   * @returns {object} Wreck request options with baseUrl/json/timeout/headers applied
   */
  _buildOptions(options = {}) {
    return {
      baseUrl: this._baseUrl,
      json: true,
      timeout: this._timeout,
      ...options,
      headers: this._buildHeaders(options.headers)
    }
  }

  /**
   * @protected
   * @param {object} [callerHeaders] headers supplied on this call
   * @returns {object} correlation, api key and caller headers merged
   */
  _buildHeaders(callerHeaders) {
    const headers = { ...requestContext.getHeaders() }

    if (this._apiKey) {
      headers[this._apiKeyHeader] = this._apiKey
    }

    return { ...headers, ...callerHeaders }
  }

  /**
   * @protected
   * @param {string} method HTTP method
   * @param {string} path Path relative to baseUrl
   * @param {object} options Wreck request options
   * @returns {Promise<object>} the Wreck result ({ res, payload })
   */
  async _request(method, path, options) {
    let res

    try {
      res = await Wreck.request(method, path, options)
    } catch (error) {
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
