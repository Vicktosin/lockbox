import type { GoogleWebSession } from './google-auth'

interface PickerDocument {
  id?: string
  name?: string
  mimeType?: string
}

interface PickerResponse {
  action?: string
  docs?: PickerDocument[]
}

interface PickerView {
  setSelectFolderEnabled(enabled: boolean): PickerView
  setMimeTypes(mimeTypes: string): PickerView
}

interface Picker {
  setVisible(visible: boolean): void
}

interface PickerBuilder {
  addView(view: PickerView): PickerBuilder
  setAppId(appId: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setOrigin(origin: string): PickerBuilder
  setCallback(callback: (value: PickerResponse) => void): PickerBuilder
  build(): Picker
}

type PickerWindow = Window & {
  gapi?: {
    load(name: string, callback: { callback: () => void }): void
  }
  google?: {
    picker?: {
      PickerBuilder: new () => PickerBuilder
      DocsView: new (viewId: string) => PickerView
      ViewId: { FOLDERS: string }
      Action: { PICKED: string; CANCEL: string }
    }
  }
}

let pickerScript: Promise<void> | null = null

async function loadPicker() {
  const pickerWindow = window as PickerWindow
  if (pickerWindow.google?.picker && pickerWindow.gapi) return
  if (!pickerScript) {
    pickerScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://apis.google.com/js/api.js'
      script.async = true
      script.defer = true
      script.onload = () => {
        const api = pickerWindow.gapi
        if (!api) {
          reject(new Error('Google Drive folder selection is unavailable.'))
          return
        }
        api.load('picker', {
          callback: () => {
            if (pickerWindow.google?.picker) resolve()
            else
              reject(new Error('Google Drive folder selection is unavailable.'))
          },
        })
      }
      script.onerror = () =>
        reject(new Error('Unable to load Google Drive folder selection.'))
      document.head.append(script)
    }).catch((error: unknown) => {
      pickerScript = null
      throw error
    })
  }
  await pickerScript
}

export async function selectGoogleDriveFolder(session: GoogleWebSession) {
  const { appId, apiKey } = session.config
  if (!appId || !apiKey)
    throw new Error('Google Drive folder selection is not configured.')
  await loadPicker()
  const pickerApi = (window as PickerWindow).google?.picker
  if (!pickerApi)
    throw new Error('Google Drive folder selection is unavailable.')

  return new Promise<{ id: string; name: string }>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Google Drive folder selection timed out.'))
    }, 300000)
    const finish = (action: 'resolve' | 'reject', value: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (action === 'resolve') resolve(value as { id: string; name: string })
      else reject(value)
    }
    const view = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder')
    new pickerApi.PickerBuilder()
      .addView(view)
      .setAppId(appId)
      .setDeveloperKey(apiKey)
      .setOAuthToken(session.accessToken)
      .setOrigin(window.location.origin)
      .setCallback((response) => {
        if (response.action === pickerApi.Action.CANCEL) {
          finish('reject', new Error('Folder selection was cancelled.'))
          return
        }
        if (response.action !== pickerApi.Action.PICKED) return
        const selected = response.docs?.[0]
        if (
          !selected ||
          typeof selected.id !== 'string' ||
          !/^[A-Za-z0-9_-]{10,150}$/.test(selected.id) ||
          selected.mimeType !== 'application/vnd.google-apps.folder'
        ) {
          finish('reject', new Error('Google returned an invalid folder.'))
          return
        }
        finish('resolve', {
          id: selected.id,
          name: selected.name ?? 'Google Drive folder',
        })
      })
      .build()
      .setVisible(true)
  })
}
