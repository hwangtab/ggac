import type { ReactNode } from 'react'
// 미리보기 칸과 편집 화면 머리줄은 업무툴 부품(FilePreviewBody·DocumentViewer·편집기 프레임)을 `data-work-app` 칸 안에서
// 그대로 쓴다 — 그 토큰(포스터 팔레트)은 이 스타일이 `[data-work-app]` 범위에서만 정한다(docs/board-work/04-조합원-문서함.md §8).
import '@work/styles.css'

/** 내 문서함 — **반드시 동적 렌더링**(세션 쿠키를 읽는다. 정적 생성되면 로그인 리다이렉트가 구워진다). */
export const dynamic = 'force-dynamic'

export default function MemberDocumentsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
