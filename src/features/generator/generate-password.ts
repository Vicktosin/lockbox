export interface GeneratorOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
}
export const defaultOptions: GeneratorOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
}
const alphabets = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}:,.?',
}
function randomIndex(limit: number) {
  const max = Math.floor(0x100000000 / limit) * limit
  const buffer = new Uint32Array(1)
  do {
    crypto.getRandomValues(buffer)
  } while (buffer[0] >= max)
  return buffer[0] % limit
}
export function generatePassword(options: GeneratorOptions) {
  const groups = (Object.keys(alphabets) as (keyof typeof alphabets)[])
    .filter((key) => options[key])
    .map((key) => alphabets[key])
  if (!groups.length) throw new Error('Choose at least one character type.')
  if (
    !Number.isInteger(options.length) ||
    options.length < 8 ||
    options.length > 64
  )
    throw new Error('Choose a length between 8 and 64.')
  const all = groups.join('')
  const result = groups.map((group) => group[randomIndex(group.length)])
  while (result.length < options.length)
    result.push(all[randomIndex(all.length)])
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result.join('')
}
