// Self-contained: Chrome serializes this function into a single top-frame isolated world.
export function inspectForm(expectedOrigin, operation = 'inspect', data = {}) {
  if (
    location.protocol !== 'https:' ||
    location.origin !== expectedOrigin ||
    window.top !== window
  )
    return { error: 'Only the approved HTTPS top-level website is supported.' }
  const visible = (input) =>
    !input.disabled &&
    !input.readOnly &&
    input.getBoundingClientRect().width > 0 &&
    input.getBoundingClientRect().height > 0 &&
    getComputedStyle(input).visibility !== 'hidden'
  const passwords = [
    ...document.querySelectorAll('input[type="password"]'),
  ].filter(visible)
  if (!passwords.length)
    return { error: 'No supported login or registration form found.' }
  const focus = document.activeElement?.form
  const forms = [...new Set(passwords.map((x) => x.form))]
  const form =
    focus && forms.includes(focus)
      ? focus
      : forms.length === 1
        ? forms[0]
        : undefined
  if (form === undefined)
    return {
      error:
        'More than one password form was found. Focus the form you intend to use, then retry.',
    }
  if (
    form &&
    new URL(form.action || location.href, location.href).origin !==
      expectedOrigin
  )
    return {
      error:
        'This form submits to a different website. Lockbox will not fill it.',
    }
  const fields = passwords.filter((x) => x.form === form),
    fresh = fields.filter((x) => x.autocomplete === 'new-password'),
    selected = fresh[0] ?? fields[0]
  const candidates = [...(form ?? document).querySelectorAll('input')].filter(
    (x) => visible(x) && ['text', 'email'].includes(x.type) && x.form === form,
  )
  const username =
    candidates.find((x) => x.autocomplete === 'username') ??
    candidates.find((x) => x.type === 'email') ??
    candidates.find((x) => /user|email|login/i.test(x.name + ' ' + x.id)) ??
    (candidates.length === 1 ? candidates[0] : null)
  const registration = fresh.length > 0 || fields.length > 1
  if (operation === 'inspect')
    return {
      origin: expectedOrigin,
      registration,
      username: username?.value ?? '',
      supported: !!username,
    }
  if (operation === 'capture') {
    if (fields.length > 1 && !fresh.length)
      return {
        error:
          'Mark the new password fields with autocomplete=new-password, or save this login directly in Lockbox.',
      }
    if (!username?.value || !selected.value)
      return {
        error:
          'Enter the username and password before asking Lockbox to save or update.',
      }
    if (fresh.length > 1 && fresh.some((x) => x.value !== selected.value))
      return { error: 'New password and confirmation do not match.' }
    if (username.value.length > 200 || selected.value.length > 256)
      return { error: 'This login exceeds Lockbox field limits.' }
    return {
      origin: expectedOrigin,
      entry: {
        name: (document.title || location.hostname).slice(0, 100),
        username: username.value,
        password: selected.value,
      },
    }
  }
  if (data.approved !== true) return { error: 'Explicit approval is required.' }
  const set = (input, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (operation === 'generate') {
    if (
      !fresh.length ||
      typeof data.password !== 'string' ||
      data.password.length < 16 ||
      data.password.length > 64
    )
      return {
        error: 'Generated insertion requires explicit new-password fields.',
      }
    for (const input of fresh.length ? fresh : fields) {
      if (location.origin !== expectedOrigin)
        return { error: 'Website changed.' }
      set(input, data.password)
    }
    return { inserted: true }
  }
  if (operation === 'fill') {
    if (
      !username ||
      typeof data.username !== 'string' ||
      typeof data.password !== 'string' ||
      data.username.length > 200 ||
      !data.password ||
      data.password.length > 256
    )
      return { error: 'Unsupported login fields.' }
    if (location.origin !== expectedOrigin) return { error: 'Website changed.' }
    set(username, data.username)
    if (location.origin !== expectedOrigin) return { error: 'Website changed.' }
    set(selected, data.password)
    return { filled: true, submitted: false }
  }
  return { error: 'Unsupported operation.' }
}
