import { LogOut } from 'lucide-react'
import type { Account } from '@/features/auth/api'
import {
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  House,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import type { Credential, Page, UserId } from '@/features/credentials/types'
import { pageLabels, users } from '@/features/credentials/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEffect, useRef, type ReactNode } from 'react'

const navigation = [
  { page: 'dashboard', icon: LayoutDashboard, label: 'Overview' },
  { page: 'library', icon: KeyRound, label: 'Password library' },
  { page: 'personal', icon: LockKeyhole, label: 'Personal vault' },
  { page: 'shared', icon: Users, label: 'Shared vault' },
] as const
export function AppShell({
  page,
  navigate,
  account,
  onLogout,
  credentials,
  user,
  sidebarOpen,
  setSidebarOpen,
  children,
  vaultActive = false,
  onLock,
}: {
  page: Page
  account?: Account
  onLogout?: () => void
  navigate: (page: Page) => void
  credentials: Credential[]
  user: UserId
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  children: ReactNode
  vaultActive?: boolean
  onLock?: () => void
}) {
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!sidebarOpen) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const sidebar = sidebarRef.current
    const controls = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>('a[href], button') ?? [],
      ).filter((element) => element.getClientRects().length > 0)
    controls()[0]?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarOpen(false)
      }
      if (event.key === 'Tab') {
        const elements = controls()
        const first = elements[0]
        const last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    const media = window.matchMedia('(min-width: 761px)')
    const onResize = () => {
      if (media.matches) setSidebarOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    media.addEventListener('change', onResize)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
      media.removeEventListener('change', onResize)
      previousFocus?.focus()
    }
  }, [sidebarOpen, setSidebarOpen])
  function go(next: Page) {
    navigate(next)
    setSidebarOpen(false)
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          tabIndex={-1}
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        role={sidebarOpen ? 'dialog' : undefined}
        aria-modal={sidebarOpen || undefined}
        className={cn('sidebar', sidebarOpen && 'sidebar-open')}
        aria-label="Main navigation"
      >
        <a
          className="brand"
          href="#/dashboard"
          onClick={() => setSidebarOpen(false)}
        >
          <span className="brand-mark">
            <LockKeyhole size={22} strokeWidth={1.7} />
          </span>
          <span>
            lockbox<span className="brand-dot">.</span>
          </span>
        </a>
        <Button
          className="sidebar-close"
          variant="ghost"
          size="icon"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        >
          <X />
        </Button>
        <div className="workspace">
          <span className="workspace-icon">
            <House size={17} />
          </span>
          <div>
            <strong>Our household</strong>
            <span>Personal workspace</span>
          </div>
          <span className="workspace-count">2</span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          <ul>
            {navigation.map(({ page: target, icon: Icon, label }) => (
              <li key={target}>
                <a
                  href={`#/${target}`}
                  onClick={() => setSidebarOpen(false)}
                  className={cn('nav-link', page === target && 'nav-active')}
                  aria-current={page === target ? 'page' : undefined}
                >
                  <Icon size={18} strokeWidth={1.7} />
                  <span>{label}</span>
                  {target !== 'dashboard' && (
                    <span className="nav-count">
                      {target === 'library'
                        ? credentials.length
                        : credentials.filter((c) => c.vault === target).length}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="nav-label tools-label">TOOLS & PREFERENCES</p>
        <nav aria-label="Tools">
          <ul>
            <li>
              <a
                className={cn('nav-link', page === 'generator' && 'nav-active')}
                href="#/generator"
                onClick={() => setSidebarOpen(false)}
                aria-current={page === 'generator' ? 'page' : undefined}
              >
                <Sparkles size={18} strokeWidth={1.7} />
                Password generator
              </a>
            </li>
            <li>
              <a
                className={cn('nav-link', page === 'settings' && 'nav-active')}
                href="#/settings"
                onClick={() => setSidebarOpen(false)}
                aria-current={page === 'settings' ? 'page' : undefined}
              >
                <Settings2 size={18} strokeWidth={1.7} />
                Settings
              </a>
            </li>
          </ul>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="sidebar-note-icon">
              <ShieldCheck size={20} />
            </span>
            <strong>A little peace of mind.</strong>
            <p>
              Your household essentials,
              <br />
              all in one place.
            </p>
            <button onClick={() => go('shared')}>
              Explore shared vault <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="demo-indicator">
            <span />
            {vaultActive ? 'Encrypted local vault' : 'Frontend demo'}{' '}
            <CircleHelp size={13}>
              <title>
                {vaultActive
                  ? 'Client-encrypted data; cloud status is available in Settings'
                  : 'Sample vault data only; no vault encryption or cloud sync'}
              </title>
            </CircleHelp>
          </div>
          <button className="profile-button" onClick={() => go('settings')}>
            <span className="avatar">{users[user].initials}</span>
            <span>
              <strong>{account?.username ?? users[user].name}</strong>
              <small>
                {vaultActive
                  ? 'Vault unlocked'
                  : account
                    ? 'Signed in · sample vault'
                    : 'Demo account'}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace-main" inert={sidebarOpen}>
        <header className="topbar">
          <div className="breadcrumbs">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu />
            </Button>
            <House size={15} />
            <ChevronRight size={13} />
            <span>{pageLabels[page]}</span>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">
              <span />
              {vaultActive ? 'Vault unlocked' : 'Demo workspace'}
            </span>
            {account && (
              <span className="signed-in-name">{account.username}</span>
            )}
            {onLogout && (
              <Button variant="ghost" size="sm" onClick={onLogout}>
                <LogOut />
                Sign out
              </Button>
            )}
            {onLock && (
              <Button variant="outline" size="sm" onClick={onLock}>
                <LockKeyhole />
                Lock vault
              </Button>
            )}
            <span className="topbar-divider" />
            <button
              className="avatar avatar-small"
              aria-label="Open profile settings"
              onClick={() => go('settings')}
            >
              {users[user].initials}
            </button>
          </div>
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="workspace-footer">
          <span>
            LOCKBOX <span className="footer-dot">·</span> A little more secure.
            A little more together.
          </span>
          <span>
            {vaultActive
              ? 'Encrypted before saving · Locks after 5 minutes idle'
              : 'Mock data only · Changes reset on refresh'}
          </span>
        </footer>
      </div>
    </div>
  )
}
