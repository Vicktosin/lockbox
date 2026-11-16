import type { Metadata } from 'next'
import '../index.css'

export const metadata: Metadata = {
  title: 'LOCKBOX',
  description: 'A private password manager for a household of two.',
  applicationName: 'LOCKBOX',
  referrer: 'no-referrer',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
