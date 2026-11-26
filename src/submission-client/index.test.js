import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

import { createServiceClient } from '../service-client/index.js'
import { createSubmissionClient } from './index.js'

vi.mock('../service-client/index.js')

const mocks = {
  createServiceClient: vi.mocked(createServiceClient)
}

const options = {
  environment: 'local',
  serviceName: 'lis-be4fe-cattle-death',
  port: 8086
}

const service = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn()
}

/**
 * @param {number} statusCode
 * @returns {Error} a failed call, as the service client throws it
 */
function failure(statusCode) {
  return Object.assign(new Error('Request failed'), { statusCode })
}

describe('createSubmissionClient()', () => {
  beforeAll(() => {
    mocks.createServiceClient.mockReturnValue(service)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('startSubmission() starts the submission of the holding', async () => {
    // Arrange
    const holding = { cph: '12/345/6789' }
    service.get.mockResolvedValueOnce({
      payload: {
        'submission-id': '7ZK-M3Q-A9D',
        status: 'DRAFT',
        'created-date': '2026-11-04T09:00:00Z',
        'animal-count': 1,
        animals: [{ 'animal-id': 'UK123456301550', status: 'COMPLETE' }]
      }
    })

    // Act
    const result =
      await createSubmissionClient(options).startSubmission(holding)

    // Assert
    expect(service.get).toHaveBeenCalledWith('submission/12/345/6789/start')
    expect(result).toEqual({
      submissionId: '7ZK-M3Q-A9D',
      status: 'DRAFT',
      createdDate: '2026-11-04T09:00:00Z',
      animals: [{ animalId: 'UK123456301550', status: 'COMPLETE' }]
    })
  })

  test('startSubmission() gives a submission answered without animals none', async () => {
    // Arrange
    const holding = { cph: '12/345/6789' }
    service.get.mockResolvedValueOnce({
      payload: {
        'submission-id': '7ZK-M3Q-A9D',
        status: 'DRAFT',
        'created-date': '2026-11-04T09:00:00Z'
      }
    })

    // Act
    const result =
      await createSubmissionClient(options).startSubmission(holding)

    // Assert
    expect(result.animals).toEqual([])
  })

  test('getSubmission() gets the submission, each part of its path encoded', async () => {
    // Arrange
    const key = { cph: '12/3 5/6789', submissionId: 'a/b' }
    service.get.mockResolvedValueOnce({
      payload: {
        'submission-id': 'a/b',
        status: 'SUBMITTED',
        'created-date': '2026-11-04T09:00:00Z',
        animals: []
      }
    })

    // Act
    const result = await createSubmissionClient(options).getSubmission(key)

    // Assert
    expect(service.get).toHaveBeenCalledWith('submission/12/3%205/6789/a%2Fb')
    expect(result).toEqual({
      submissionId: 'a/b',
      status: 'SUBMITTED',
      createdDate: '2026-11-04T09:00:00Z',
      animals: []
    })
  })

  test('getSubmission() throws not found for a submission the BE4FE does not hold', async () => {
    // Arrange
    const key = { cph: '12/345/6789', submissionId: '7ZK-M3Q-A9D' }
    service.get.mockRejectedValueOnce(failure(404))

    // Act
    let error
    try {
      await createSubmissionClient(options).getSubmission(key)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.isBoom).toBe(true)
    expect(error.output.statusCode).toBe(404)
  })

  test('getSubmission() throws any other failure as it is', async () => {
    // Arrange
    const key = { cph: '12/345/6789', submissionId: '7ZK-M3Q-A9D' }
    const unavailable = failure(503)
    service.get.mockRejectedValueOnce(unavailable)

    // Act
    let error
    try {
      await createSubmissionClient(options).getSubmission(key)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBe(unavailable)
  })

  test('submit() sends the submission', async () => {
    // Arrange
    const key = { cph: '12/345/6789', submissionId: '7ZK-M3Q-A9D' }
    service.post.mockResolvedValueOnce({ payload: {} })

    // Act
    const result = await createSubmissionClient(options).submit(key)

    // Assert
    expect(service.post).toHaveBeenCalledWith(
      'submission/12/345/6789/7ZK-M3Q-A9D',
      {}
    )
    expect(result).toBeUndefined()
  })

  test('submit() throws a submission that cannot be sent as it is', async () => {
    // Arrange
    const key = { cph: '12/345/6789', submissionId: '7ZK-M3Q-A9D' }
    const unavailable = failure(503)
    service.post.mockRejectedValueOnce(unavailable)

    // Act
    let error
    try {
      await createSubmissionClient(options).submit(key)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBe(unavailable)
  })

  test('getAnimal() gets the answers of the animal', async () => {
    // Arrange
    const key = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550'
    }
    const data = [{ key: 'dateOfDeath', value: '2026-11-01', type: 'DATE' }]
    service.get.mockResolvedValueOnce({
      payload: { 'animal-id': 'UK123456301550', status: 'COMPLETE', data }
    })

    // Act
    const result = await createSubmissionClient(options).getAnimal(key)

    // Assert
    expect(service.get).toHaveBeenCalledWith(
      'submission/12/345/6789/7ZK-M3Q-A9D/UK123456301550'
    )
    expect(result).toEqual({
      animalId: 'UK123456301550',
      status: 'COMPLETE',
      data
    })
  })

  test('getAnimal() gives an animal answered without answers none', async () => {
    // Arrange
    const key = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550'
    }
    service.get.mockResolvedValueOnce({
      payload: { 'animal-id': 'UK123456301550', status: 'DRAFT' }
    })

    // Act
    const result = await createSubmissionClient(options).getAnimal(key)

    // Assert
    expect(result.data).toEqual([])
  })

  test('getAnimal() throws not found for an animal the BE4FE does not hold', async () => {
    // Arrange
    const key = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550'
    }
    service.get.mockRejectedValueOnce(failure(404))

    // Act
    let error
    try {
      await createSubmissionClient(options).getAnimal(key)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.isBoom).toBe(true)
    expect(error.output.statusCode).toBe(404)
  })

  test('saveAnimal() saves a new animal under its id', async () => {
    // Arrange
    const data = [{ key: 'dateOfDeath', value: '2026-11-01', type: 'DATE' }]
    const animal = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550',
      status: 'COMPLETE',
      data
    }
    service.post.mockResolvedValueOnce({ payload: {} })

    // Act
    const result = await createSubmissionClient(options).saveAnimal(animal)

    // Assert
    expect(service.post).toHaveBeenCalledWith(
      'submission/12/345/6789/7ZK-M3Q-A9D/UK123456301550',
      { payload: { status: 'COMPLETE', data } }
    )
    expect(service.delete).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  test('saveAnimal() leaves an animal saved under the id it had where it is', async () => {
    // Arrange
    const animal = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550',
      previousAnimalId: 'UK123456301550',
      status: 'DRAFT',
      data: []
    }
    service.post.mockResolvedValueOnce({ payload: {} })

    // Act
    await createSubmissionClient(options).saveAnimal(animal)

    // Assert
    expect(service.delete).not.toHaveBeenCalled()
  })

  test('saveAnimal() takes an animal saved under another id out from under the old one', async () => {
    // Arrange
    const animal = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301551',
      previousAnimalId: 'UK123456301550',
      status: 'DRAFT',
      data: []
    }
    service.post.mockResolvedValueOnce({ payload: {} })
    service.delete.mockResolvedValueOnce({ payload: {} })

    // Act
    await createSubmissionClient(options).saveAnimal(animal)

    // Assert
    expect(service.post).toHaveBeenCalledWith(
      'submission/12/345/6789/7ZK-M3Q-A9D/UK123456301551',
      { payload: { status: 'DRAFT', data: [] } }
    )
    expect(service.delete).toHaveBeenCalledWith(
      'submission/12/345/6789/7ZK-M3Q-A9D/UK123456301550'
    )
  })

  test('saveAnimal() throws not found for a submission the BE4FE does not hold, removing nothing', async () => {
    // Arrange
    const animal = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301551',
      previousAnimalId: 'UK123456301550',
      status: 'DRAFT',
      data: []
    }
    service.post.mockRejectedValueOnce(failure(404))

    // Act
    let error
    try {
      await createSubmissionClient(options).saveAnimal(animal)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.output.statusCode).toBe(404)
    expect(service.delete).not.toHaveBeenCalled()
  })

  test('removeAnimal() takes the animal out of the submission', async () => {
    // Arrange
    const key = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550'
    }
    service.delete.mockResolvedValueOnce({ payload: {} })

    // Act
    const result = await createSubmissionClient(options).removeAnimal(key)

    // Assert
    expect(service.delete).toHaveBeenCalledWith(
      'submission/12/345/6789/7ZK-M3Q-A9D/UK123456301550'
    )
    expect(result).toBeUndefined()
  })

  test('removeAnimal() leaves an animal already gone gone', async () => {
    // Arrange
    const key = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550'
    }
    service.delete.mockRejectedValueOnce(failure(404))

    // Act
    let error
    try {
      await createSubmissionClient(options).removeAnimal(key)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeUndefined()
  })

  test('removeAnimal() throws any other failure as it is', async () => {
    // Arrange
    const key = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301550'
    }
    const unavailable = failure(503)
    service.delete.mockRejectedValueOnce(unavailable)

    // Act
    let error
    try {
      await createSubmissionClient(options).removeAnimal(key)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBe(unavailable)
  })

  test('it is a service client built from the options it is given', () => {
    // Arrange
    // Act
    const client = createSubmissionClient(options)

    // Assert
    expect(mocks.createServiceClient).toHaveBeenCalledWith(options)
    expect(client).toEqual(expect.objectContaining(service))
    expect(Object.isFrozen(client)).toBe(true)
  })

  test('startSubmission() throws not found for a holding the BE4FE does not know', async () => {
    // Arrange
    const holding = { cph: '12/345/6789' }
    const missing = failure(404)
    service.get.mockRejectedValueOnce(missing)

    // Act
    let error
    try {
      await createSubmissionClient(options).startSubmission(holding)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.output.statusCode).toBe(404)
    expect(error.cause).toBe(missing)
  })

  test.each([
    ['12/345'],
    ['12/345/6789/1'],
    ['12/../6789'],
    ['12//6789'],
    [undefined]
  ])(
    'startSubmission() throws not found for the CPH %j, calling nothing',
    async (cph) => {
      // Arrange
      const holding = { cph }

      // Act
      let error
      try {
        await createSubmissionClient(options).startSubmission(holding)
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.output.statusCode).toBe(404)
      expect(service.get).not.toHaveBeenCalled()
    }
  )

  test.each([[''], ['.'], ['..'], ['start'], [undefined]])(
    'getSubmission() throws not found for the submission id %j, calling nothing',
    async (submissionId) => {
      // Arrange
      const key = { cph: '12/345/6789', submissionId }

      // Act
      let error
      try {
        await createSubmissionClient(options).getSubmission(key)
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.output.statusCode).toBe(404)
      expect(service.get).not.toHaveBeenCalled()
    }
  )

  test('submit() throws not found for a submission the BE4FE does not hold', async () => {
    // Arrange
    const key = { cph: '12/345/6789', submissionId: '7ZK-M3Q-A9D' }
    service.post.mockRejectedValueOnce(failure(404))

    // Act
    let error
    try {
      await createSubmissionClient(options).submit(key)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.output.statusCode).toBe(404)
  })

  test.each([[''], ['.'], ['..'], [undefined]])(
    'getAnimal() throws not found for the animal id %j, calling nothing',
    async (animalId) => {
      // Arrange
      const key = { cph: '12/345/6789', submissionId: '7ZK-M3Q-A9D', animalId }

      // Act
      let error
      try {
        await createSubmissionClient(options).getAnimal(key)
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.output.statusCode).toBe(404)
      expect(service.get).not.toHaveBeenCalled()
    }
  )

  test.each([[''], ['.'], ['..'], [undefined]])(
    'saveAnimal() throws not found for the animal id %j, saving nothing',
    async (animalId) => {
      // Arrange
      const animal = {
        cph: '12/345/6789',
        submissionId: '7ZK-M3Q-A9D',
        animalId,
        status: 'DRAFT',
        data: []
      }

      // Act
      let error
      try {
        await createSubmissionClient(options).saveAnimal(animal)
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.output.statusCode).toBe(404)
      expect(service.post).not.toHaveBeenCalled()
    }
  )

  test('saveAnimal() leaves an animal no longer under its old id saved', async () => {
    // Arrange
    const animal = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301551',
      previousAnimalId: 'UK123456301550',
      status: 'DRAFT',
      data: []
    }
    service.post.mockResolvedValueOnce({ payload: {} })
    service.delete.mockRejectedValueOnce(failure(404))

    // Act
    let error
    try {
      await createSubmissionClient(options).saveAnimal(animal)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeUndefined()
  })

  test('saveAnimal() throws a failure to take the animal out from under its old id', async () => {
    // Arrange
    const animal = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301551',
      previousAnimalId: 'UK123456301550',
      status: 'DRAFT',
      data: []
    }
    const unavailable = failure(503)
    service.post.mockResolvedValueOnce({ payload: {} })
    service.delete.mockRejectedValueOnce(unavailable)

    // Act
    let error
    try {
      await createSubmissionClient(options).saveAnimal(animal)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBe(unavailable)
    expect(service.post).toHaveBeenCalledTimes(1)
  })

  test('saveAnimal() removes nothing for an animal with no old id given as null', async () => {
    // Arrange
    const animal = {
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D',
      animalId: 'UK123456301551',
      previousAnimalId: null,
      status: 'DRAFT',
      data: []
    }
    service.post.mockResolvedValueOnce({ payload: {} })

    // Act
    await createSubmissionClient(options).saveAnimal(animal)

    // Assert
    expect(service.delete).not.toHaveBeenCalled()
  })

  test('its functions work apart from the client', async () => {
    // Arrange
    const { getSubmission } = createSubmissionClient(options)
    service.get.mockResolvedValueOnce({
      payload: { 'submission-id': '7ZK-M3Q-A9D', status: 'DRAFT' }
    })

    // Act
    const result = await getSubmission({
      cph: '12/345/6789',
      submissionId: '7ZK-M3Q-A9D'
    })

    // Assert
    expect(result.submissionId).toBe('7ZK-M3Q-A9D')
  })
})
