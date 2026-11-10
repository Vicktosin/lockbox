import {
  ArrowDownUp,
  ChevronRight,
  Grid2X2,
  List,
  Plus,
  Search,
  SearchX,
  Users,
  LockKeyhole,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form'
import { cn } from '@/lib/utils'
import type { Credential, Page } from './types'
import { categories } from './types'
import { credentialHealth, dateLabel, hostname } from './helpers'
import { SiteIcon, VaultBadge } from './credential-badges'

export function CredentialTable({
  credentials,
  allCredentials,
  onSelect,
  compact = false,
}: {
  credentials: Credential[]
  allCredentials: Credential[]
  onSelect: (credential: Credential) => void
  compact?: boolean
}) {
  return (
    <div className="table-scroll">
      <table className="credential-table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="table-username">Username</th>
            <th>Vault</th>
            {!compact && <th className="table-health">Password health</th>}
            <th>
              <span className="sr-only">Open credential</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {credentials.map((credential) => {
            const health = credentialHealth(credential, allCredentials)
            return (
              <tr key={credential.id}>
                <td>
                  <button
                    className="credential-name"
                    onClick={() => onSelect(credential)}
                  >
                    <SiteIcon credential={credential} />
                    <span>
                      <strong>{credential.name}</strong>
                      <small>{hostname(credential.url)}</small>
                      <small className="mobile-username">
                        {credential.username}
                      </small>
                    </span>
                  </button>
                </td>
                <td className="table-username">
                  <span className="username-text">{credential.username}</span>
                </td>
                <td>
                  <VaultBadge vault={credential.vault} />
                </td>
                {!compact && (
                  <td className="table-health">
                    <span
                      className={cn(
                        'health-badge',
                        health !== 'Strong' && 'health-warning',
                      )}
                    >
                      <span />
                      {health}
                    </span>
                  </td>
                )}
                <td>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`View ${credential.name}`}
                    onClick={() => onSelect(credential)}
                  >
                    <ChevronRight />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
export function CredentialLibrary({
  page,
  credentials,
  onSelect,
  onAdd,
  vaultActive = false,
}: {
  page: Page
  credentials: Credential[]
  onSelect: (credential: Credential) => void
  onAdd: () => void
  vaultActive?: boolean
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [sort, setSort] = useState('recent')
  const scoped =
    page === 'personal' || page === 'shared'
      ? credentials.filter((item) => item.vault === page)
      : credentials
  const filtered = scoped
    .filter(
      (item) =>
        (category === 'all' || item.category === category) &&
        [item.name, item.username, item.url].some((value) =>
          value.toLowerCase().includes(query.toLowerCase().trim()),
        ),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  const title =
    page === 'personal'
      ? 'Personal vault'
      : page === 'shared'
        ? 'Shared vault'
        : 'Password library'
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {page === 'shared' ? 'BETTER TOGETHER' : 'YOUR DIGITAL ESSENTIALS'}
          </p>
          <h1>
            {title}
            <span className="heading-count">{scoped.length}</span>
          </h1>
          <p>
            {page === 'shared'
              ? 'One home for the accounts you share. Accessible to both household members.'
              : page === 'personal'
                ? vaultActive
                  ? 'Your own space. Only this account can access its encrypted Personal vault.'
                  : 'Your own space. Only this demo profile’s private credentials appear here.'
                : 'Every login, neatly in place. Find what you need in a moment.'}
          </p>
        </div>
        <Button onClick={onAdd}>
          <Plus />
          Add credential
        </Button>
      </div>
      {page !== 'library' && (
        <div
          className={cn('vault-notice', page === 'shared' && 'shared-notice')}
        >
          {page === 'shared' ? <Users size={20} /> : <LockKeyhole size={20} />}
          <div>
            <strong>
              {page === 'shared'
                ? 'Shared with your household'
                : vaultActive
                  ? 'Private to your account'
                  : 'Private to this demo profile'}
            </strong>
            <p>
              {vaultActive
                ? 'Encrypted on this device. Household access requires a separate grant and transferred key.'
                : page === 'shared'
                  ? 'Both Emmanuel and Partner can view and manage these sample credentials.'
                  : 'Switch demo profiles in Settings to explore separate personal vaults. Privacy is simulated in the frontend.'}
            </p>
          </div>
          <span className="subtle-tag">
            {vaultActive ? 'ENCRYPTED' : 'Demo vault'}
          </span>
        </div>
      )}
      <section className="panel library-panel" aria-label="Credential library">
        <div className="library-toolbar">
          <div className="search-field">
            <Search size={17} />
            <Input
              aria-label="Search credentials"
              placeholder="Search names, usernames or websites…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </div>
          <div className="library-controls">
            <Select
              aria-label="Filter by category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
            <div className="view-switch" role="group" aria-label="Presentation">
              <button
                aria-label="List view"
                aria-pressed={view === 'list'}
                className={cn(view === 'list' && 'selected')}
                onClick={() => setView('list')}
              >
                <List size={17} />
              </button>
              <button
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                className={cn(view === 'grid' && 'selected')}
                onClick={() => setView('grid')}
              >
                <Grid2X2 size={16} />
              </button>
            </div>
          </div>
        </div>
        <div className="results-bar">
          <span>
            {filtered.length}{' '}
            {filtered.length === 1 ? 'credential' : 'credentials'}
            {category !== 'all' && ` in ${category}`}
          </span>
          <label>
            <ArrowDownUp size={13} />
            <span className="sr-only">Sort credentials</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="recent">Recently added</option>
              <option value="name">Name, A–Z</option>
            </select>
          </label>
        </div>
        {filtered.length ? (
          view === 'list' ? (
            <CredentialTable
              credentials={filtered}
              allCredentials={credentials}
              onSelect={onSelect}
            />
          ) : (
            <div className="credential-grid">
              {filtered.map((item) => (
                <button
                  className="credential-card"
                  key={item.id}
                  onClick={() => onSelect(item)}
                >
                  <div className="credential-card-top">
                    <SiteIcon credential={item} />
                    <VaultBadge vault={item.vault} />
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.username}</p>
                  <span>{hostname(item.url)}</span>
                  <div className="credential-card-bottom">
                    <span>{item.category}</span>
                    <small>{dateLabel(item.createdAt)}</small>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="empty-state">
            <SearchX />
            <h2>
              {scoped.length
                ? 'No matching credentials'
                : 'A fresh start for your vault'}
            </h2>
            <p>
              {scoped.length
                ? 'Try another search or choose a different category.'
                : vaultActive
                  ? 'Add a credential to get started.'
                  : 'Add a sample credential to get started.'}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                if (scoped.length) {
                  setQuery('')
                  setCategory('all')
                } else onAdd()
              }}
            >
              {scoped.length ? 'Clear filters' : 'Add credential'}
            </Button>
          </div>
        )}
      </section>
      <p className="page-footnote">
        {vaultActive
          ? 'Encrypted before saving. Cloud connection and sync status are in Settings. Clipboard clearing is best effort; independent security review is pending.'
          : 'All credentials are fictional. This demo does not provide secure storage or cloud sync.'}
      </p>
    </>
  )
}
