import { useState } from 'react'
import { CopyButton } from '@/components/ui/copy-button'
import { request } from './native-api'
import { Button } from '@/components/ui/button'
import type { NativeStatus } from './native-api'
export function DriveTestMode({
  status,
  busy,
  onSwitch,
}: {
  status: NativeStatus
  busy: boolean
  onSwitch: () => void
}) {
  const [report, setReport] = useState(''),
    [message, setMessage] = useState('')
  return (
    <section className="panel settings-panel">
      <div className="settings-body">
        <h2>
          {status.googleTestMode
            ? 'Isolated Google Drive test'
            : 'Google Drive release gate'}
        </h2>
        <p>
          {status.googleTestMode
            ? 'This separate vault is for fictional entries and real Google qualification only. Existing local vaults and recovery information are not imported.'
            : 'Live uploads from existing vaults remain blocked while device revocation, key rotation and security review are unfinished. Google registration alone cannot enable them.'}
        </p>
        {!status.googleConfigured && (
          <p>
            Developer Google registration is not installed. You do not need to
            configure Google Cloud or edit settings.
          </p>
        )}
        {status.googleTestMode && (
          <p>
            Use names beginning Fictional, websites ending .invalid, and
            usernames ending @example.invalid. Generate new test passwords; do
            not reuse any real passwords or master passwords.
          </p>
        )}
        <Button variant="outline" disabled={busy} onClick={onSwitch}>
          {status.googleTestMode
            ? 'Return to local preview'
            : 'Open separate Google Drive test'}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void request('google-test-report')
              .then((value) => {
                setReport(JSON.stringify(value, null, 2))
                setMessage(
                  'Report contains no passwords, keys, tokens or email addresses. Physical two-computer completion is never asserted automatically.',
                )
              })
              .catch((error) => setMessage(error.message))
          }}
        >
          Prepare safe Google test report
        </Button>
        {report && (
          <>
            <textarea
              className="form-input"
              aria-label="Safe Google test report"
              readOnly
              value={report}
            />
            <CopyButton
              value={report}
              label="Copy safe test report"
              onError={setMessage}
            />
          </>
        )}
        {message && <p role="status">{message}</p>}
        <p className="field-hint">
          Opening the other mode closes this window. Saved vaults remain in
          separate locations. This is not a production-security approval or a
          completed two-computer test.
        </p>
      </div>
    </section>
  )
}
