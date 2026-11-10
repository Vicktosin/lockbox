import { useEffect, useState } from 'react'
import type { Page } from '@/features/credentials/types'

const pages: Page[] = [
  'dashboard',
  'library',
  'personal',
  'shared',
  'generator',
  'settings',
]
function currentPage(): Page {
  const value = window.location.hash.replace('#/', '')
  return pages.includes(value as Page) ? (value as Page) : 'dashboard'
}
export function useNavigation() {
  const [page, setPage] = useState<Page>(currentPage)
  useEffect(() => {
    const update = () => setPage(currentPage())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  function navigate(next: Page) {
    window.location.hash = `/${next}`
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  return { page, navigate }
}
