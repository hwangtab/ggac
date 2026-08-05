import { NOINDEX_METADATA } from '@/constants/seo'
import type { ReactNode } from 'react'

// 탭 제목이 사이트명만 나와 여러 탭을 띄웠을 때 구분되지 않았다.
// 색인은 그대로 막는다.
export const metadata = { ...NOINDEX_METADATA, title: '조합원 가입' }

export default function SignupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
