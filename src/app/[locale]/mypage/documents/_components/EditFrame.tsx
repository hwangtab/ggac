import type { ReactNode } from 'react'

/**
 * 편집 화면의 바깥 틀 — 전역 내비 아래에서 콘텐츠 폭 전체·화면 높이에 맞춘다(업무툴 편집 화면과 같은 생각). 편집기
 * 머리줄과 경고 띠는 업무툴 토큰(`data-work-app` — 포스터 팔레트)으로 그린다.
 */
export default function EditFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 pt-16 md:pt-20">
      <div className="mx-auto w-full max-w-[1600px] px-2 py-3 md:px-4">
        <div
          data-work-app
          className="flex h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded border bg-card font-sans text-foreground md:h-[calc(100dvh-6.5rem)]"
        >
          {children}
        </div>
      </div>
    </div>
  )
}
