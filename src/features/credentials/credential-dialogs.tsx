import {
  Eye,
  EyeOff,
  ExternalLink,
  Pencil,
  Trash2,
  LockKeyhole,
  Users,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Modal } from '@/components/ui/modal'
import { Field, Input, Select } from '@/components/ui/form'
import { SiteIcon, VaultBadge } from './credential-badges'
import type { Credential, CredentialDraft, UserId, Vault } from './types'
import { categories } from './types'
import { dateLabel, hostname, passwordQuality } from './helpers'
import {
  defaultOptions,
  generatePassword,
} from '@/features/generator/generate-password'

export function CredentialDetails({
  credential,
  onClose,
  onEdit,
  onDelete,
  notify,
  persisted = false,
}: {
  credential: Credential
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  notify: (message: string) => void
  persisted?: boolean
}) {
  const [showPassword, setShowPassword] = useState(false)
  return (
    <Modal
      title="Credential details"
      description={
        persisted
          ? 'Decrypted on this device · encrypted before saving'
          : 'Fictional demo credential · stored in memory only'
      }
      onClose={onClose}
    >
      <div className="detail-identity">
        <SiteIcon credential={credential} large />
        <div>
          <h3>{credential.name}</h3>
          <span>{hostname(credential.url)}</span>
        </div>
        <VaultBadge vault={credential.vault} />
      </div>
      <div className="detail-fields">
        <div className="detail-field">
          <span>Website</span>
          <div>
            <a href={credential.url} target="_blank" rel="noreferrer">
              {credential.url}
              <ExternalLink size={13} />
            </a>
            <CopyButton
              value={credential.url}
              label="Copy website"
              onError={notify}
            />
          </div>
        </div>
        <div className="detail-field">
          <span>Username / email</span>
          <div>
            <span className="detail-value">{credential.username}</span>
            <CopyButton
              value={credential.username}
              label="Copy username"
              onError={notify}
            />
          </div>
        </div>
        <div className="detail-field">
          <span>Password</span>
          <div>
            <input
              aria-label="Credential password"
              type={showPassword ? 'text' : 'password'}
              readOnly
              value={credential.password}
              className="detail-password"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
            <CopyButton
              value={credential.password}
              label="Copy password"
              onError={notify}
            />
          </div>
        </div>
        <div className="detail-field">
          <span>Notes</span>
          <p className="detail-notes">
            {credential.notes || 'No notes added.'}
          </p>
          {credential.notes && (
            <CopyButton
              value={credential.notes}
              label="Copy notes"
              onError={notify}
            />
          )}
        </div>
        <div className="detail-metadata">
          <div>
            <span>Category</span>
            <strong>{credential.category}</strong>
          </div>
          <div>
            <span>Date added</span>
            <strong>{dateLabel(credential.createdAt)}</strong>
          </div>
        </div>
      </div>
      <div className="detail-vault-note">
        {credential.vault === 'shared' ? (
          <Users size={16} />
        ) : (
          <LockKeyhole size={16} />
        )}
        <span>
          {persisted
            ? credential.vault === 'shared'
              ? 'Shared with joined Household accounts.'
              : 'Private to this account.'
            : credential.vault === 'shared'
              ? 'Visible to both household demo profiles.'
              : 'Visible only to this demo profile.'}
        </span>
      </div>
      <div className="modal-actions">
        <Button variant="ghost" className="danger-text" onClick={onDelete}>
          <Trash2 />
          Delete
        </Button>
        <Button onClick={onEdit}>
          <Pencil />
          Edit credential
        </Button>
      </div>
    </Modal>
  )
}
export function CredentialForm({
  credential,
  user,
  initialVault = 'personal',
  initialPassword = '',
  onClose,
  onSave,
  persisted = false,
  folders = [],
  busy = false,
  sharedAvailable = true,
}: {
  credential?: Credential
  user: UserId
  initialVault?: Vault
  initialPassword?: string
  onClose: () => void
  onSave: (draft: CredentialDraft) => void
  persisted?: boolean
  folders?: { id: string; name: string; vault: Vault }[]
  busy?: boolean
  sharedAvailable?: boolean
}) {
  const [draft, setDraft] = useState<CredentialDraft>(() =>
    credential
      ? {
          name: credential.name,
          url: credential.url,
          username: credential.username,
          password: credential.password,
          notes: credential.notes,
          category: credential.category,
          vault: credential.vault,
          owner: credential.owner,
          folderId: credential.folderId,
        }
      : {
          name: '',
          url: '',
          username: '',
          password: initialPassword,
          notes: '',
          category: 'Personal',
          vault: initialVault,
          owner: user,
        },
  )
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  function change<K extends keyof CredentialDraft>(
    key: K,
    value: CredentialDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !draft.name.trim() ||
      !draft.username.trim() ||
      !draft.password.trim()
    ) {
      setError('Enter a name, username and sample password.')
      return
    }
    try {
      const url = new URL(draft.url)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error()
    } catch {
      setError(
        'Enter a complete HTTP or HTTPS URL, such as https://example.com.',
      )
      return
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      username: draft.username.trim(),
      url: draft.url.trim(),
    })
  }
  return (
    <Modal
      title={credential ? 'Edit credential' : 'Add a credential'}
      description={
        persisted
          ? 'Encrypted locally before saving to the backend. Independent security review is still pending.'
          : 'Demo only. Do not enter real passwords or sensitive notes.'
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="credential-form">
        <div className="form-two-columns">
          <Field label="Website / app name" htmlFor="credential-name">
            <Input
              id="credential-name"
              value={draft.name}
              onChange={(e) => change('name', e.target.value)}
              placeholder="e.g. Notion"
              required
              maxLength={100}
              autoFocus
            />
          </Field>
          <Field label="Website URL" htmlFor="credential-url">
            <Input
              id="credential-url"
              type="url"
              value={draft.url}
              onChange={(e) => change('url', e.target.value)}
              placeholder="https://example.com"
              required
              maxLength={2000}
            />
          </Field>
        </div>
        <Field label="Username / email" htmlFor="credential-username">
          <Input
            id="credential-username"
            value={draft.username}
            onChange={(e) => change('username', e.target.value)}
            placeholder="you@example.com"
            required
            maxLength={200}
            autoComplete="off"
          />
        </Field>
        <Field
          label={persisted ? 'Password' : 'Sample password'}
          htmlFor="credential-password"
        >
          <div className="password-input-wrap">
            <Input
              id="credential-password"
              type={visible ? 'text' : 'password'}
              value={draft.password}
              onChange={(e) => change('password', e.target.value)}
              required
              autoComplete="off"
              maxLength={256}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={visible ? 'Hide password' : 'Show password'}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <div className="password-form-meta">
            <span>
              {draft.password
                ? passwordQuality(draft.password)
                  ? 'Good length and character variety'
                  : 'Try 12+ characters and more variety'
                : persisted
                  ? 'Generate a unique password.'
                  : 'Use a fictional password for this demo'}
            </span>
            <button
              type="button"
              onClick={() =>
                change('password', generatePassword(defaultOptions))
              }
            >
              Generate password
            </button>
          </div>
        </Field>
        <div className="form-two-columns">
          <Field label="Folder / category" htmlFor="credential-category">
            <Select
              id="credential-category"
              value={draft.category}
              onChange={(e) =>
                change(
                  'category',
                  e.target.value as CredentialDraft['category'],
                )
              }
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          </Field>
          <Field label="Save to vault" htmlFor="credential-vault">
            <Select
              id="credential-vault"
              value={draft.vault}
              onChange={(e) => {
                change('vault', e.target.value as Vault)
                change('owner', user)
                change('folderId', undefined)
              }}
            >
              <option value="personal">Personal vault — just you</option>
              {sharedAvailable && (
                <option value="shared">Shared vault — your household</option>
              )}
            </Select>
          </Field>
        </div>
        {persisted && (
          <Field label="Password folder" htmlFor="credential-folder">
            <Select
              id="credential-folder"
              value={draft.folderId ?? ''}
              onChange={(e) => change('folderId', e.target.value || undefined)}
            >
              <option value="">No folder</option>
              {folders
                .filter((folder) => folder.vault === draft.vault)
                .map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Notes" htmlFor="credential-notes">
          <textarea
            className="form-input"
            id="credential-notes"
            rows={3}
            value={draft.notes}
            onChange={(e) => change('notes', e.target.value)}
            placeholder="A helpful detail for next time…"
            maxLength={4000}
          />
        </Field>
        <p className="field-hint">
          {persisted
            ? draft.vault === 'shared'
              ? 'Joined Household accounts can read and edit this credential.'
              : 'This credential is encrypted in your Personal vault.'
            : draft.vault === 'shared'
              ? 'Both demo profiles can access and edit this sample credential.'
              : 'This sample credential will appear only for your current demo profile.'}{' '}
          {persisted
            ? 'Changes persist as ciphertext.'
            : 'Changes reset on refresh.'}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {credential ? 'Save changes' : 'Add credential'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
export function DeleteCredential({
  credential,
  onClose,
  onConfirm,
  persisted = false,
  busy = false,
}: {
  credential: Credential
  onClose: () => void
  onConfirm: () => void
  persisted?: boolean
  busy?: boolean
}) {
  return (
    <Modal
      title="Delete this credential?"
      description={
        persisted
          ? 'This permanently removes the credential from the current encrypted vault.'
          : 'This removes the sample credential from this demo session.'
      }
      onClose={onClose}
    >
      <div className="delete-message">
        <span className="delete-icon">
          <Trash2 />
        </span>
        <p>
          <strong>{credential.name}</strong> will be removed
          {credential.vault === 'shared'
            ? ' for both household demo profiles'
            : ' from your personal demo vault'}
          {persisted
            ? '. This cannot be undone from this app.'
            : '. You can reset the original mock data in Settings.'}
        </p>
      </div>
      <div className="modal-actions">
        <Button variant="outline" onClick={onClose} autoFocus>
          Keep credential
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={busy}>
          Delete credential
        </Button>
      </div>
    </Modal>
  )
}
