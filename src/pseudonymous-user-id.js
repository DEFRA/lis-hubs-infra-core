import { createHmac } from 'node:crypto'

/**
 * Derives a pseudonymous, stable user identifier from an email address,
 * for use as index context - never the raw email itself so that PII leakage is limited.
 * Returns null when either input is missing, so callers can skip setting
 * it rather than deriving a meaningless hash.
 *
 * @param {string} email
 * @param {string} secret - Fixed, securely-stored key. Must not be a
 *   per-request or randomly generated value - the same email must always
 *   produce the same id, so it can be used to correlate a user's requests.
 * @returns {string | null}
 */
export function derivePseudonymousUserId(email, secret) {
  if (!email || !secret) {
    return null
  }
  return createHmac('sha256', secret).update(email).digest('hex')
}
