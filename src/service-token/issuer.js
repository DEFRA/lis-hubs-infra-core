import { GetWebIdentityTokenCommand, STSClient } from '@aws-sdk/client-sts'

import { SIGNING_ALGORITHM } from './constants.js'

const DURATION_SECONDS = 900
const REFRESH_BEFORE_EXPIRY_SECONDS = 60
const MILLISECONDS_PER_SECOND = 1000

// The client lives for the process, as CDP's guide suggests for a global instance.
// The SDK has no timeouts by default and the token call sits in every
// proxied request's path.
const stsClient = new STSClient({
  requestHandler: { connectionTimeout: 2000, requestTimeout: 3000 },
  maxAttempts: 2
})
/** @type {Map<string, { token: string, expiresAt: number }>} */
const cache = new Map()
/** @type {Map<string, Promise<string>>} */
const inFlight = new Map()

async function fetchToken(audience) {
  // Tags are deliberately omitted: they are rejected on CDP container roles.
  const response = await stsClient.send(
    new GetWebIdentityTokenCommand({
      Audience: [audience],
      DurationSeconds: DURATION_SECONDS,
      SigningAlgorithm: SIGNING_ALGORITHM
    })
  )

  if (!response?.WebIdentityToken) {
    throw new Error('STS response did not include a WebIdentityToken')
  }

  const expiresAt = new Date(response.Expiration).getTime()
  if (Number.isNaN(expiresAt)) {
    throw new Error('STS response did not include a valid Expiration')
  }

  cache.set(audience, { token: response.WebIdentityToken, expiresAt })
  return response.WebIdentityToken
}

/**
 * @param {string} audience
 * @returns {Promise<string>}
 */
export async function getServiceToken(audience) {
  const cached = cache.get(audience)
  const now = Date.now()

  if (cached && now < cached.expiresAt) {
    const refreshFrom =
      cached.expiresAt - REFRESH_BEFORE_EXPIRY_SECONDS * MILLISECONDS_PER_SECOND
    if (now >= refreshFrom) {
      // Callers keep the still-valid token; a failure leaves it cached so a
      // later call retries.
      refreshToken(audience).catch(() => undefined)
    }
    return cached.token
  }

  return refreshToken(audience)
}

function refreshToken(audience) {
  const pending = inFlight.get(audience)
  if (pending) {
    return pending
  }

  const request = fetchTokenOnce(audience)
  inFlight.set(audience, request)
  return request
}

async function fetchTokenOnce(audience) {
  try {
    return await fetchToken(audience)
  } finally {
    inFlight.delete(audience)
  }
}
