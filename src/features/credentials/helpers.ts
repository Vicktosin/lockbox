import type { Credential } from './types'

export function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
export function passwordQuality(password: string) {
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length
  return password.length >= 12 && groups >= 3
}
export function credentialHealth(
  credential: Credential,
  credentials: Credential[],
) {
  if (!passwordQuality(credential.password)) return 'Weak'
  if (
    credentials.some(
      (item) =>
        item.id !== credential.id && item.password === credential.password,
    )
  )
    return 'Reused'
  return 'Strong'
}
export function securitySummary(credentials: Credential[]) {
  const weak = credentials.filter(
    (item) => !passwordQuality(item.password),
  ).length
  const reused = credentials.filter((item) =>
    credentials.some(
      (other) => other.id !== item.id && other.password === item.password,
    ),
  ).length
  const healthy = credentials.filter(
    (item) => credentialHealth(item, credentials) === 'Strong',
  ).length
  return {
    weak,
    reused,
    healthy,
    score: credentials.length
      ? Math.round((healthy / credentials.length) * 100)
      : 100,
  }
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}
