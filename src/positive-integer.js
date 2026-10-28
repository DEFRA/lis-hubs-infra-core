/**
 * @param {string} name the option's name, for the error
 * @param {unknown} value
 * @returns {number} value, when it is a positive integer
 * @throws {Error} naming the option otherwise
 */
export function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}
