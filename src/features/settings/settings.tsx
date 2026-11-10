import {
  Laptop,
  LockKeyhole,
  Monitor,
  Moon,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/form'
import type { UserId } from '@/features/credentials/types'
import { users } from '@/features/credentials/types'
import { cn } from '@/lib/utils'
export type Appearance = 'light' | 'dark' | 'system'
export function Settings({
  user,
  onUserChange,
  appearance,
  onAppearanceChange,
  onReset,
  vaultActive = false,
}: {
  user: UserId
  onUserChange: (user: UserId) => void
  appearance: Appearance
  onAppearanceChange: (theme: Appearance) => void
  onReset: () => void
  vaultActive?: boolean
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h1>Settings</h1>
          <p>A few familiar details. A space that feels like you.</p>
        </div>
      </div>
      <div className="settings-layout">
        {!vaultActive && (
          <section className="panel settings-panel">
            <div className="settings-heading">
              <span className="setting-icon">
                <Users />
              </span>
              <div>
                <h2>Account & household</h2>
                <p>
                  Sample vault profiles; switching these does not change your
                  signed-in account.
                </p>
              </div>
              <span className="subtle-tag">MOCK</span>
            </div>
            <div className="settings-body">
              <div className="account-summary">
                <span className="avatar avatar-large">
                  {users[user].initials}
                </span>
                <div>
                  <strong>{users[user].name}</strong>
                  <span>{users[user].email}</span>
                  <small>Our household · Demo member</small>
                </div>
              </div>
              <Field
                label="Explore as a demo user"
                htmlFor="demo-user"
                hint="Switch profiles to see separate personal vaults and the same shared household credentials. This simulates privacy; it is not access control."
              >
                <Select
                  id="demo-user"
                  value={user}
                  onChange={(e) => onUserChange(e.target.value as UserId)}
                >
                  <option value="emmanuel">Emmanuel — demo profile</option>
                  <option value="partner">Partner — demo profile</option>
                </Select>
              </Field>
            </div>
          </section>
        )}
        <section className="panel settings-panel">
          <div className="settings-heading">
            <span className="setting-icon">
              <Sun />
            </span>
            <div>
              <h2>Appearance</h2>
              <p>Your workspace, in your preferred light.</p>
            </div>
          </div>
          <div
            className="settings-body appearance-options"
            role="group"
            aria-label="Appearance"
          >
            {(
              [
                {
                  value: 'light',
                  icon: Sun,
                  label: 'Light',
                  description: 'A little breathing room',
                },
                {
                  value: 'dark',
                  icon: Moon,
                  label: 'Dark',
                  description: 'Easy on the evening',
                },
                {
                  value: 'system',
                  icon: Monitor,
                  label: 'System',
                  description: 'Follow your device',
                },
              ] as const
            ).map(({ value, icon: Icon, label, description }) => (
              <button
                key={value}
                aria-pressed={appearance === value}
                className={cn(
                  'appearance-option',
                  appearance === value && 'appearance-selected',
                )}
                onClick={() => onAppearanceChange(value)}
              >
                <span className={`theme-preview preview-${value}`}>
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <Icon size={15} />
                  <strong>{label}</strong>
                </span>
                <small>{description}</small>
              </button>
            ))}
          </div>
        </section>
        {!vaultActive && (
          <>
            <section className="panel settings-panel">
              <div className="settings-heading">
                <span className="setting-icon">
                  <ShieldCheck />
                </span>
                <div>
                  <h2>Security</h2>
                  <p>The foundation for future protection.</p>
                </div>
                <span className="subtle-tag">PLANNED</span>
              </div>
              <div className="settings-body placeholder-settings">
                <div>
                  <LockKeyhole size={18} />
                  <span>
                    <strong>Master password & encryption</strong>
                    <small>Not implemented. No encrypted vault exists.</small>
                  </span>
                  <span className="planned-label">Coming later</span>
                </div>
                <div>
                  <ShieldCheck size={18} />
                  <span>
                    <strong>Two-factor authentication</strong>
                    <small>
                      Authentication will be designed in a future phase.
                    </small>
                  </span>
                  <span className="planned-label">Coming later</span>
                </div>
              </div>
            </section>
            <section className="panel settings-panel">
              <div className="settings-heading">
                <span className="setting-icon">
                  <Laptop />
                </span>
                <div>
                  <h2>Devices & sync</h2>
                  <p>A preview of your future connected household.</p>
                </div>
                <span className="subtle-tag">PLANNED</span>
              </div>
              <div className="settings-body">
                <div className="device-placeholder">
                  <Monitor size={24} />
                  <div>
                    <strong>This browser</strong>
                    <p>Local frontend session · Not registered as a device</p>
                  </div>
                </div>
                <div className="device-placeholder muted-device">
                  <Smartphone size={24} />
                  <div>
                    <strong>PWA & Chrome extension</strong>
                    <p>
                      Installation, cloud sync and device management are not
                      active.
                    </p>
                  </div>
                </div>
              </div>
            </section>
            <section className="panel settings-panel reset-panel">
              <div>
                <h2>Start fresh</h2>
                <p>
                  Restore sample credentials for both users. Current session
                  edits will be discarded.
                </p>
              </div>
              <Button variant="outline" onClick={onReset}>
                <RotateCcw />
                Reset demo data
              </Button>
            </section>
          </>
        )}
      </div>
    </>
  )
}
