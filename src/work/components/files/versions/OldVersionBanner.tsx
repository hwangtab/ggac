'use client'

import { InfoIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { NoticeBanner } from '@work/components/layout/page'
import { formatDateTime } from '@work/lib/format/datetime'
import type { FileVersionState } from '@work/lib/files/version-rules'
import { namedFileUrl } from '../FilePreviewBody'

/**
 * 옛 버전을 열었을 때 미리보기 위에 띄우는 띠(docs/09 §3-2):
 * "최신 버전이 있습니다 — v5 · 김OO · 10월 26일 10:32 [최신 열기]". 최종본이 따로 있으면 "최종본: v4" 도.
 * 최신이면 아무것도 그리지 않는다. `onOpenLatest` 가 없으면 새 탭에서 연다.
 */
export default function OldVersionBanner({
  state,
  onOpenLatest,
}: {
  state: FileVersionState | null
  onOpenLatest?: (attachmentId: string) => void
}) {
  if (!state || !state.latestId || state.latestId === state.attachmentId) return null
  const latest = state.versions.find(v => v.id === state.latestId)
  if (!latest) return null
  const finalVersion =
    state.finalId && state.finalId !== state.latestId
      ? state.versions.find(v => v.id === state.finalId)
      : null

  return (
    <NoticeBanner role="status" icon={InfoIcon}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">최신 버전이 있습니다</strong> — v{latest.versionNo} ·{' '}
          {latest.uploaderName ?? '알 수 없는 사용자'} · {formatDateTime(latest.createdAt)}
          {finalVersion && (
            <span className="ml-2 text-muted-foreground">최종본: v{finalVersion.versionNo}</span>
          )}
        </p>
        {onOpenLatest ? (
          <button
            type="button"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            onClick={() => onOpenLatest(latest.id)}
          >
            최신 열기
          </button>
        ) : (
          <a
            href={namedFileUrl(latest.id, latest.name)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            최신 열기
          </a>
        )}
      </div>
    </NoticeBanner>
  )
}
