import Boom from '@hapi/boom'

import { createServiceClient } from '../service-client/index.js'

/** @import { ServiceCall, ServiceClientOptions } from '../service-client/index.js' */

const NOT_FOUND = 404

// The status of a submission that has been sent
export const SUBMITTED_STATUS = 'SUBMITTED'

/**
 * @typedef {object} SubmissionKey
 * @property {string} cph - the holding, as 12/345/6789
 * @property {string} submissionId - the BE4FE's submission id
 */

/**
 * @typedef {object} AnimalKey
 * @property {string} cph - the holding, as 12/345/6789
 * @property {string} submissionId - the BE4FE's submission id
 * @property {string} animalId - the animal's id in the submission
 */

/**
 * @typedef {object} DataItem - one of an animal's answers, as the BE4FE holds it
 * @property {string} key - the answer's name
 * @property {string | null} value - null for an answer given as nothing
 * @property {string} type - STRING, DATE, INT, NUMBER or BOOL
 */

/**
 * @typedef {object} SubmissionAnimal - an animal as its submission lists it
 * @property {string} animalId
 * @property {string} status
 */

/**
 * @typedef {object} Submission
 * @property {string} submissionId
 * @property {string} status
 * @property {string} createdDate
 * @property {SubmissionAnimal[]} animals - in the order they were last saved
 */

/**
 * @typedef {object} Animal - an animal's answers, as the BE4FE holds them
 * @property {string} animalId
 * @property {string} status
 * @property {DataItem[]} data
 */

/**
 * @typedef {object} AnimalSave
 * @property {string} cph - the holding, as 12/345/6789
 * @property {string} submissionId - the BE4FE's submission id
 * @property {string} animalId - the id to save the animal under
 * @property {string} [previousAnimalId] - the id the animal was saved under
 *   before, when it has had one
 * @property {string} status - the animal's status once saved
 * @property {DataItem[]} data - the animal's answers, replacing those held
 */

/**
 * @typedef {object} SubmissionClient - a service client for a BE4FE, with
 *   its submission endpoints as functions
 * @property {ServiceCall} get
 * @property {ServiceCall} post
 * @property {ServiceCall} put
 * @property {ServiceCall} patch
 * @property {ServiceCall} delete
 * @property {(holding: { cph: string }) => Promise<Submission>} startSubmission
 *   starts the holding's submission, or continues the one it has not sent
 * @property {(key: SubmissionKey) => Promise<Submission>} getSubmission
 * @property {(key: SubmissionKey) => Promise<void>} submit - sends the
 *   submission; the BE4FE keeps it unsent if it cannot
 * @property {(key: AnimalKey) => Promise<Animal>} getAnimal
 * @property {(animal: AnimalSave) => Promise<void>} saveAnimal - replaces
 *   the animal, adding it to the submission on its first save; an animal
 *   saved under another id than before is taken out from under the old one
 * @property {(key: AnimalKey) => Promise<void>} removeAnimal - takes the
 *   animal out of the submission; one already gone is left gone
 */

const CPH_PARTS = 3
// A segment a URL would resolve away, leaving the path of something else
const RELATIVE_SEGMENTS = new Set(['.', '..'])
// The segment after a holding that starts its submission
const START = 'start'

/**
 * @param {unknown} value - one part of a path
 * @returns {string} the part, encoded for a path
 * @throws {Boom.Boom} not found, for a part no path can hold: one that is
 *   not text, is empty, or would resolve to another path
 */
function segment(value) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    RELATIVE_SEGMENTS.has(value)
  ) {
    throw Boom.notFound()
  }

  return encodeURIComponent(value)
}

/**
 * @param {string} cph - as 12/345/6789
 * @returns {string} the path of the holding's submissions, each part of the
 *   CPH encoded
 * @throws {Boom.Boom} not found, for a CPH that is not three parts
 */
function holdingPath(cph) {
  const parts = typeof cph === 'string' ? cph.split('/') : []

  if (parts.length !== CPH_PARTS) {
    throw Boom.notFound()
  }

  return `submission/${parts.map(segment).join('/')}`
}

/**
 * @param {SubmissionKey} key
 * @returns {string} the path of the submission, under its holding
 * @throws {Boom.Boom} not found, for an id that is the start endpoint's own
 *   segment
 */
function submissionPath({ cph, submissionId }) {
  if (submissionId === START) {
    throw Boom.notFound()
  }

  return `${holdingPath(cph)}/${segment(submissionId)}`
}

/**
 * @param {AnimalKey} key
 * @returns {string} the path of the animal in its submission
 */
function animalPath({ cph, submissionId, animalId }) {
  return `${submissionPath({ cph, submissionId })}/${segment(animalId)}`
}

/**
 * Something the BE4FE does not hold is something that does not exist.
 * @template T
 * @param {Promise<T>} call - a call to the BE4FE
 * @returns {Promise<T>} its answer
 * @throws {Boom.Boom} not found, for a call the BE4FE answers not found
 */
async function notFoundAsBoom(call) {
  try {
    return await call
  } catch (error) {
    if (error.statusCode === NOT_FOUND) {
      throw Object.assign(Boom.notFound(), { cause: error })
    }

    throw error
  }
}

/**
 * @param {object} payload - a submission as the BE4FE answers it
 * @returns {Submission}
 */
function toSubmission(payload) {
  return {
    submissionId: payload['submission-id'],
    status: payload.status,
    createdDate: payload['created-date'],
    animals: (payload.animals ?? []).map((animal) => ({
      animalId: animal['animal-id'],
      status: animal.status
    }))
  }
}

/**
 * The submission endpoints every BE4FE built on the shared submissions SDK
 * serves: a holding's unsent submission and the animals in it. The BE4FE
 * stores whatever it is given, so validate before a save. A submission or
 * animal the BE4FE does not hold under the holding is thrown as a Boom not
 * found; the BE4FE answers the two alike.
 *
 * It is a service client for the BE4FE, taking the same options, so the
 * BE4FE's other endpoints are called through the same client:
 *
 *   const be4fe = createSubmissionClient({ environment, serviceName })
 *   const { submissionId } = await be4fe.startSubmission({ cph })
 *   const { payload } = await be4fe.get(`data/${cph}/ear-tags/unallocated`)
 *
 * The functions do not depend on `this`, so they can be passed around
 * freely.
 * @param {ServiceClientOptions} options - as createServiceClient takes them
 * @returns {SubmissionClient}
 */
export function createSubmissionClient(options) {
  const service = createServiceClient(options)

  /** @type {SubmissionClient['removeAnimal']} */
  async function removeAnimal(key) {
    try {
      await notFoundAsBoom(service.delete(animalPath(key)))
    } catch (error) {
      if (!Boom.isBoom(error, NOT_FOUND)) {
        throw error
      }
    }
  }

  return Object.freeze({
    ...service,

    async startSubmission({ cph }) {
      const { payload } = await notFoundAsBoom(
        service.get(`${holdingPath(cph)}/${START}`)
      )

      return toSubmission(payload)
    },

    async getSubmission(key) {
      const { payload } = await notFoundAsBoom(service.get(submissionPath(key)))

      return toSubmission(payload)
    },

    async submit(key) {
      await notFoundAsBoom(service.post(submissionPath(key), {}))
    },

    async getAnimal(key) {
      const { payload } = await notFoundAsBoom(service.get(animalPath(key)))

      return {
        animalId: payload['animal-id'],
        status: payload.status,
        data: payload.data ?? []
      }
    },

    async saveAnimal({
      cph,
      submissionId,
      animalId,
      previousAnimalId,
      status,
      data
    }) {
      await notFoundAsBoom(
        service.post(animalPath({ cph, submissionId, animalId }), {
          payload: { status, data }
        })
      )

      // One after the other: the BE4FE turns away a second write to a
      // submission that overlaps the first
      if (previousAnimalId && previousAnimalId !== animalId) {
        await removeAnimal({ cph, submissionId, animalId: previousAnimalId })
      }
    },

    removeAnimal
  })
}
