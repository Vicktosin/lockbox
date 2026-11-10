let timer: ReturnType<typeof setTimeout> | undefined,
  owned: string | null = null,
  revision = 0
export async function clearSecretClipboard(
  notify: (message: string) => void = () => {},
) {
  clearTimeout(timer)
  const value = owned
  owned = null
  const attempt = ++revision
  if (value === null) return
  try {
    if (navigator.clipboard.readText) {
      if ((await navigator.clipboard.readText()) !== value) return
    }
    if (attempt !== revision) return
    await navigator.clipboard.writeText('')
  } catch {
    notify(
      'Automatic clipboard clearing was blocked by the browser. Clear it manually; clipboard history may retain copies.',
    )
  }
}
export async function copySecret(
  value: string,
  notify: (message: string) => void,
) {
  await navigator.clipboard.writeText(value)
  owned = value
  clearTimeout(timer)
  const attempt = ++revision
  timer = setTimeout(() => {
    if (attempt === revision) void clearSecretClipboard(notify)
  }, 30000)
}
