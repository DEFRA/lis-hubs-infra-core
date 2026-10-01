import { GetWebIdentityTokenCommand, STSClient } from '@aws-sdk/client-sts'

import { SIGNING_ALGORITHM } from './constants.js'

const MAX_DURATION_SECONDS = 900
const MIN_DURATION_SECONDS = 60
const SESSION_EXPIRY_MARGIN_SECONDS = 60
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

/**
 * A token can't outlive the role session that requests it (STS rejects that
 * with SessionDurationEscalation), and the SDK keeps credentials until they
 * are 5 minutes from expiry, so the duration is capped by the time the
 * current credentials have left.
 *
 * @returns {Promise<number>}
 */
async function getTokenDurationSeconds() {
  const { expiration } = await stsClient.config.credentials()
  if (!expiration) {
    return MAX_DURATION_SECONDS
  }

  const secondsLeft =
    Math.floor((expiration.getTime() - Date.now()) / MILLISECONDS_PER_SECOND) -
    SESSION_EXPIRY_MARGIN_SECONDS
  if (secondsLeft < MIN_DURATION_SECONDS) {
    throw new Error(
      'The role session expires too soon to issue a service token'
    )
  }

  return Math.min(MAX_DURATION_SECONDS, secondsLeft)
}

async function fetchToken(audience) {
  // Tags are deliberately omitted: they are rejected on CDP container roles.
  const response = await stsClient.send(
    new GetWebIdentityTokenCommand({
      Audience: [audience],
      DurationSeconds: await getTokenDurationSeconds(),
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
  if (pending !== undefined) {
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
