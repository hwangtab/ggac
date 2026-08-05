import { Suspense } from 'react'
import { NOINDEX_METADATA } from '@/constants/seo'
import type { ReactNode } from 'react'

// 탭 제목이 사이트명만 나와 여러 탭을 띄웠을 때 구분되지 않았다.
// 색인은 그대로 막는다.
export const metadata = { ...NOINDEX_METADATA, title: '로그인' }

// 로그인 페이지(클라이언트)가 useSearchParams(?redirect=)를 사용하므로 자체
// Suspense 경계가 필요하다. 과거에는 [locale]/layout.tsx의 전역 Suspense가
// 이를 흡수했지만, 그 경계는 모든 페이지의 404 상태코드를 soft-404(200)로
// 만들어 제거됐다(2026-07 전수감사 백로그) — 경계는 필요한 라우트가 자체 부담한다.
export default function LoginLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}
