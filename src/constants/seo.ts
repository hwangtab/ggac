import type { Metadata } from 'next'

export const NOINDEX_METADATA: Metadata = {
  robots: { index: false, follow: true },
}
