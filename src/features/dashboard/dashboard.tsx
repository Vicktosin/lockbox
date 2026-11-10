import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Credential, Page, UserId } from '@/features/credentials/types'
import { users } from '@/features/credentials/types'
import { CredentialTable } from '@/features/credentials/credential-library'
import { securitySummary } from '@/features/credentials/helpers'

export function Dashboard({
  credentials,
  user,
  displayName,
  navigate,
  onAdd,
  onSelect,
  vaultActive = false,
}: {
  credentials: Credential[]
  user: UserId
  displayName?: string
  navigate: (page: Page) => void
  onAdd: () => void
  onSelect: (credential: Credential) => void
  vaultActive?: boolean
}) {
  const personal = credentials.filter(
    (item) => item.vault === 'personal',
  ).length
  const shared = credentials.length - personal
  const security = securitySummary(credentials)
  const recent = [...credentials]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">YOUR SPACE. YOUR PEACE OF MIND.</p>
          <h1>
            Welcome back, {displayName ?? users[user].name}
            <span className="greeting-dot">.</span>
          </h1>
          <p>Everything that matters, safely in view.</p>
        </div>
        <Button onClick={onAdd}>
          <Plus />
          Add credential
        </Button>
      </div>
      <div className="demo-banner">
        <span className="demo-banner-symbol">i</span>
        <span>
          {vaultActive
            ? 'Your vault is decrypted only on this device. '
            : 'You’re exploring a demo workspace. '}
          <strong>
            {vaultActive
              ? 'Independent security review pending.'
              : 'Use fictional credentials only.'}
          </strong>
        </span>
        <span className="demo-banner-tag">
          {vaultActive ? 'CLIENT-SIDE ENCRYPTION' : 'NO CLOUD CONNECTION'}
        </span>
      </div>
      <div className="stats-grid">
        <button className="stat-card" onClick={() => navigate('library')}>
          <div className="stat-top">
            <span>Total passwords</span>
            <span className="stat-icon violet">
              <KeyRound size={18} />
            </span>
          </div>
          <strong>{credentials.length.toString().padStart(2, '0')}</strong>
          <div className="stat-bottom">
            <span>Across your accessible vaults</span>
            <ArrowUpRight size={17} />
          </div>
        </button>
        <button className="stat-card" onClick={() => navigate('personal')}>
          <div className="stat-top">
            <span>Personal vault</span>
            <span className="stat-icon blue">
              <LockKeyhole size={18} />
            </span>
          </div>
          <strong>{personal.toString().padStart(2, '0')}</strong>
          <div className="stat-bottom">
            <span>
              Just for you <span className="tiny-dot" /> Private
            </span>
            <ArrowUpRight size={17} />
          </div>
        </button>
        <button className="stat-card" onClick={() => navigate('shared')}>
          <div className="stat-top">
            <span>Shared vault</span>
            <span className="stat-icon mint">
              <Users size={18} />
            </span>
          </div>
          <strong>{shared.toString().padStart(2, '0')}</strong>
          <div className="stat-bottom">
            <span>For the two of you</span>
            <span className="mini-avatars">
              <i>ET</i>
              <i>PT</i>
            </span>
          </div>
        </button>
      </div>
      <div className="dashboard-columns">
        <div className="dashboard-primary">
          <section className="household-card">
            <div className="household-copy">
              <span className="household-kicker">
                <Users size={13} /> YOUR HOUSEHOLD, CONNECTED
              </span>
              <h2>
                Some things are
                <br />
                better shared.
              </h2>
              <p>
                From movie nights to your next getaway.
                <br className="desktop-break" /> Keep everyday accounts in one
                shared space.
              </p>
              <button onClick={() => navigate('shared')}>
                Open shared vault <ArrowRight size={15} />
              </button>
            </div>
            <div className="vault-illustration" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="illustration-card back-card">
                <span />
                <span />
                <span />
              </div>
              <div className="illustration-card front-card">
                <div className="illustration-lock">
                  <LockKeyhole size={35} strokeWidth={1.4} />
                </div>
                <span className="illustration-dots">•••• ••••</span>
                <div className="illustration-line" />
                <div className="illustration-users">
                  <i>ET</i>
                  <i>PT</i>
                  <Check size={12} />
                </div>
              </div>
              <span className="illustration-spark spark-one">+</span>
              <span className="illustration-spark spark-two">+</span>
            </div>
          </section>
          <section className="panel recent-panel">
            <div className="section-heading">
              <div>
                <h2>Recently added</h2>
                <p>Your latest additions, right where you need them.</p>
              </div>
              <button className="text-link" onClick={() => navigate('library')}>
                View all <ArrowRight size={14} />
              </button>
            </div>
            {recent.length ? (
              <CredentialTable
                credentials={recent}
                allCredentials={credentials}
                onSelect={onSelect}
                compact
              />
            ) : (
              <div className="empty-state">
                <KeyRound />
                <h3>Your vault starts here</h3>
                <Button onClick={onAdd}>
                  {vaultActive ? 'Add a credential' : 'Add a sample credential'}
                </Button>
              </div>
            )}
          </section>
        </div>
        <div className="dashboard-secondary">
          <section className="panel security-panel">
            <div className="section-heading">
              <h2>Security overview</h2>
              <ShieldCheck size={18} />
            </div>
            <span className="subtle-tag">
              {vaultActive ? 'LOCAL ASSESSMENT' : 'SAMPLE ASSESSMENT'}
            </span>
            <div
              className="score-ring"
              style={{ '--score': `${security.score}%` } as React.CSSProperties}
            >
              <div>
                <strong>
                  {security.score}
                  <small>%</small>
                </strong>
                <span>{vaultActive ? 'illustrative score' : 'demo score'}</span>
              </div>
            </div>
            <h3>
              {security.score === 100
                ? 'Looking good'
                : 'A little room to improve'}
            </h3>
            <p className="security-description">
              A simple check of password length, variety and reuse.
            </p>
            <div className="security-list">
              <div>
                <span>
                  <span className="status-dot status-green" />
                  Strong & unique
                </span>
                <strong>{security.healthy}</strong>
              </div>
              <div>
                <span>
                  <span className="status-dot status-amber" />
                  Weak passwords
                </span>
                <strong>{security.weak}</strong>
              </div>
              <div>
                <span>
                  <span className="status-dot status-orange" />
                  Reused passwords
                </span>
                <strong>{security.reused}</strong>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate('library')}
              className="w-full"
            >
              Review passwords <ChevronRight />
            </Button>
            <p className="security-disclaimer">
              <TriangleAlert size={12} />
              Not a breach scan or security audit.
            </p>
          </section>
          <section className="panel quick-actions">
            <h2>Make yourself at home</h2>
            <button onClick={onAdd}>
              <span className="quick-icon">
                <Plus size={17} />
              </span>
              <span>
                <strong>Add a credential</strong>
                <small>A new home for your login</small>
              </span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate('generator')}>
              <span className="quick-icon">
                <Sparkles size={17} />
              </span>
              <span>
                <strong>Generate a password</strong>
                <small>Let randomness do the work</small>
              </span>
              <ChevronRight size={15} />
            </button>
          </section>
        </div>
      </div>
    </>
  )
}
