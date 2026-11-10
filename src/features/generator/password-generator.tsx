import {
  Check,
  Copy,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  defaultOptions,
  generatePassword,
  type GeneratorOptions,
} from './generate-password'

export function PasswordGenerator({
  notify,
  onUse,
}: {
  notify: (message: string) => void
  onUse: (password: string) => void
}) {
  const [options, setOptions] = useState<GeneratorOptions>(defaultOptions)
  const [password, setPassword] = useState(() =>
    generatePassword(defaultOptions),
  )
  const [show, setShow] = useState(true)
  const [outdated, setOutdated] = useState(false)
  const selected = [
    options.uppercase,
    options.lowercase,
    options.numbers,
    options.symbols,
  ].filter(Boolean).length
  function regenerate() {
    try {
      setPassword(generatePassword(options))
      setOutdated(false)
    } catch (error) {
      notify((error as Error).message)
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            A LITTLE RANDOMNESS. A LOT MORE POSSIBILITY.
          </p>
          <h1>Password generator</h1>
          <p>Create a fresh password, with the ingredients you choose.</p>
        </div>
        <span className="outline-label">
          <Sparkles size={14} />
          Local generation
        </span>
      </div>
      <div className="generator-layout">
        <section className="panel generator-panel">
          <div className="section-heading">
            <h2>Your next password</h2>
            <KeyRound size={19} />
          </div>
          <div className="generated-password">
            <input
              aria-label="Generated password"
              type={show ? 'text' : 'password'}
              value={password}
              readOnly
              spellCheck={false}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                show ? 'Hide generated password' : 'Show generated password'
              }
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <div className="generation-note">
            <span className="status-dot status-green" />
            {password.length} characters <span>·</span> Generated on this device
          </div>
          <div className="generator-buttons">
            <Button onClick={regenerate} disabled={!selected}>
              <RefreshCw />
              Generate password
            </Button>
            <CopyButton
              value={password}
              label="Copy password"
              showLabel
              onError={notify}
            />
          </div>
          <div className="generator-options">
            <div className="range-heading">
              <label htmlFor="password-length">Password length</label>
              <output htmlFor="password-length">{options.length}</output>
            </div>
            <input
              id="password-length"
              type="range"
              min="8"
              max="64"
              value={options.length}
              onChange={(event) => {
                setOptions({ ...options, length: Number(event.target.value) })
                setOutdated(true)
              }}
            />
            <div className="range-labels">
              <span>8 characters</span>
              <span>64 characters</span>
            </div>
            <h3>Include character types</h3>
            {(
              [
                ['uppercase', 'Uppercase letters', 'A–Z'],
                ['lowercase', 'Lowercase letters', 'a–z'],
                ['numbers', 'Numbers', '0–9'],
                ['symbols', 'Symbols', '!@#$%'],
              ] as const
            ).map(([key, label, sample]) => (
              <label className="option-row" key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>{sample}</small>
                </span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) => {
                    setOptions({ ...options, [key]: event.target.checked })
                    setOutdated(true)
                  }}
                />
              </label>
            ))}
            {!selected && (
              <p className="form-error" role="alert">
                Choose at least one character type to generate a password.
              </p>
            )}
            {outdated && (
              <p className="field-hint" role="status">
                Options changed. Generate again to apply them.
              </p>
            )}
          </div>
          <div className="generator-use">
            <p>Have an account in mind?</p>
            <Button variant="outline" onClick={() => onUse(password)}>
              <Plus />
              Use in a new credential
            </Button>
          </div>
        </section>
        <aside className="generator-aside">
          <div className="panel tip-panel">
            <span className="tip-icon">
              <ShieldCheck size={24} />
            </span>
            <h2>A strong start.</h2>
            <p>
              Long, unique passwords are a good habit. Give every account its
              own.
            </p>
            <ul>
              <li>
                <Check />
                Aim for at least 16 characters.
              </li>
              <li>
                <Check />
                Mix different character types.
              </li>
              <li>
                <Check />
                Keep each password unique.
              </li>
            </ul>
          </div>
          <div className="generator-privacy">
            <Copy size={17} />
            <div>
              <strong>Only here, for now.</strong>
              <p>
                Generated values stay in memory unless you copy them. This
                frontend is a demo; do not use it to manage real credentials.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}
