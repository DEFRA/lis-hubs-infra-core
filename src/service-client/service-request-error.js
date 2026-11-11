const UNPROCESSABLE_ENTITY = 422

/**
 * @typedef {{ serviceName: string, method: string, path: string }} FailedCall
 *   the call that failed
 */

/**
 * @param {number} [statusCode]
 * @param {object} [payload] - the service's error body
 * @returns {string} the message for a failed call
 */
function messageFor(statusCode, payload) {
  if (payload?.error?.code) {
    return `${payload.error.code} - ${payload.error.message}`
  }

  if (payload?.detail || payload?.title) {
    return `${payload.status} - ${payload.detail || payload.title}`
  }

  return statusCode === UNPROCESSABLE_ENTITY
    ? 'Validation failed'
    : `Request failed - ${statusCode}`
}

/**
 * Thrown when a call to a service fails: it could not be reached, timed out,
 * or answered with an error status. Carries what whoever logs it needs.
 */
export class ServiceRequestError extends Error {
  name = 'ServiceRequestError'

  /**
   * @param {string} message
   * @param {{ serviceName: string, method: string, path: string, statusCode?: number, cause?: Error }} details
   *   statusCode is the service's own, or 504 for a timeout; it is undefined
   *   when the service could not be reached at all
   */
  constructor(message, { serviceName, method, path, statusCode, cause }) {
    super(message, cause && { cause })
    this.statusCode = statusCode
    this.serviceName = serviceName
    this.method = method
    this.path = path
  }

  /**
   * The service could not be reached, or did not answer in time.
   * @param {FailedCall} call
   * @param {Error & { output?: object, data?: object }} cause - what the
   *   transport threw
   * @returns {ServiceRequestError}
   */
  static fromTransportError(call, cause) {
    const statusCode = cause.output?.statusCode

    return new ServiceRequestError(
      messageFor(statusCode, cause.data?.payload),
      { ...call, statusCode, cause }
    )
  }

  /**
   * The service answered, but its body could not be read.
   * @param {FailedCall} call
   * @param {number} statusCode - the service's own, or 504 if reading timed
   *   out
   * @param {Error} cause
   * @returns {ServiceRequestError}
   */
  static fromReadError(call, statusCode, cause) {
    return new ServiceRequestError(messageFor(statusCode), {
      ...call,
      statusCode,
      cause
    })
  }

  /**
   * The service answered with an error status.
   * @param {FailedCall} call
   * @param {number} statusCode
   * @param {object} [payload] - the service's error body
   * @returns {ServiceRequestError}
   */
  static fromResponse(call, statusCode, payload) {
    return new ServiceRequestError(messageFor(statusCode, payload), {
      ...call,
      statusCode
    })
  }
}
