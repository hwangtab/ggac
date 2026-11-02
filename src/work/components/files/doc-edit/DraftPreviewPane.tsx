'use client'

import { useState } from 'react'
import { AlertTriangleIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { NoticeBanner } from '@work/components/layout/page'
import { BLOCKED_HINT, type DraftOutcome } from '@work/lib/files/doc-edit-types'
import { draftPageUrl, newDraftPageUrl } from './doc-edit-ui'

/** 한 번에 그리는 쪽 수 — 나머지는 [더 보기] */
const PAGE_STEP = 10

/** 초안 미리보기(docs/10 §2-2·§2-3): 요약 · 반영 안 된 수정 · 막힘 안내 · 쪽 그림 */
export default function DraftPreviewPane({
  attachmentId,
  outcome,
  stale,
  busy,
  error,
  onUseLocalEdit,
}: {
  /** 첨부에서 만든 초안이면 원본 첨부 id. 없으면 새 한글 문서의 첫 저장본(docs/18) */
  attachmentId?: string | null
  outcome: DraftOutcome | null
  /** 입력을 바꿔 미리보기가 낡았다 */
  stale: boolean
  busy: boolean
  error: string | null
  onUseLocalEdit?: () => void
}) {
  const [shown, setShown] = useState(PAGE_STEP)

  if (busy) {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        미리보기를 만드는 중…
      </p>
    )
  }
  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (!outcome) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        입력 칸을 채우거나 고친 뒤 [미리보기]를 누르면 원본 모양 그대로 확인할 수 있어요.
      </p>
    )
  }

  const totalPages = outcome.pageCount ?? 0
  const pages = Math.min(totalPages, outcome.previewPages ?? totalPages)
  return (
    <div className="grid gap-3 p-4">
      {stale && (
        <NoticeBanner role="status">
          입력이 바뀌었습니다. 다시 미리보기를 눌러 확인해 주세요.
        </NoticeBanner>
      )}

      {outcome.blocked && (
        <NoticeBanner role="alert" tone="destructive" icon={AlertTriangleIcon}>
          <div className="grid gap-2">
            <p className="font-medium">
              {outcome.blockedReason ? `${outcome.blockedReason} ` : ''}
              {BLOCKED_HINT}
            </p>
            {onUseLocalEdit && (
              <div>
                <Button type="button" size="sm" variant="outline" onClick={onUseLocalEdit}>
                  내 PC에서 수정
                </Button>
              </div>
            )}
          </div>
        </NoticeBanner>
      )}

      <p role="status" className="text-sm">
        {outcome.mode === 'fill'
          ? `채운 칸 ${outcome.applied}개`
          : outcome.mode === 'patch'
            ? `반영한 수정 ${outcome.applied}개`
            : '앱에서 편집한 문서'}
        {outcome.pageCount !== null &&
          outcome.originalPageCount !== null &&
          ` · ${outcome.pageCount}쪽(원본 ${outcome.originalPageCount}쪽)`}
      </p>

      {outcome.unmatched.length > 0 && (
        <div className="rounded-w-md border p-2 text-sm">
          <p className="font-medium">못 채운 칸</p>
          <ul className="list-inside list-disc text-muted-foreground">
            {outcome.unmatched.map(u => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {outcome.skipped.length > 0 && (
        <NoticeBanner>
          <div>
            <p className="font-medium">반영 안 된 수정 {outcome.skipped.length}개</p>
            <ul className="grid gap-1.5">
              {outcome.skipped.map((s, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium">
                    {s.partial ? '일부만 반영 — ' : ''}
                    {s.reason}
                  </span>
                  {(s.before || s.after) && (
                    <span className="block text-muted-foreground">
                      {s.before ?? ''} → {s.after ?? ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </NoticeBanner>
      )}

      {outcome.warnings.length > 0 && (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {outcome.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {outcome.previewAvailable && pages > 0 ? (
        <div className="grid gap-3">
          {Array.from({ length: Math.min(pages, shown) }, (_, i) => i + 1).map(p => (
            // eslint-disable-next-line @next/next/no-img-element -- 인증이 필요한 쪽 SVG(<img> 전용 응답)라 next/image 를 쓰지 않는다
            <img
              key={p}
              src={
                !attachmentId
                  ? newDraftPageUrl(outcome.uploadId, p)
                  : draftPageUrl(attachmentId, outcome.uploadId, p)
              }
              alt={`미리보기 ${p}쪽`}
              loading="lazy"
              className="w-full rounded-w-md border bg-white"
            />
          ))}
          {totalPages > pages && shown >= pages && (
            <p className="text-xs text-muted-foreground">
              앞 {pages}쪽만 미리보기로 보여 드려요. 저장하면 문서 전체가 반영됩니다.
            </p>
          )}
          {pages > shown && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShown(n => n + PAGE_STEP)}
            >
              더 보기 ({pages - shown}쪽 남음)
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">쪽 그림을 만들지 못했습니다.</p>
      )}
    </div>
  )
}
