'use client'

import { useRouter } from '@work/lib/nav/navigation'
import SaveVersionDialog from '@work/components/files/versions/SaveVersionDialog'
import { useFileVersionState } from '@work/components/files/versions/use-file-version-state'

/**
 * 파일 탭 "새 버전 올리기"(docs/05 §4-1, docs/09 §3-3) — 파일 버전 계보에 새 최신 버전을 저장한다(saveFileVersion).
 * 탭은 계보의 최신을 보여 주므로 별도 탭 설정 갱신이 필요 없다. 기준 버전은 지금 최신이다
 * (탭에서 보던 파일 위에 새로 올리는 것이라 충돌이 아니다). 편집 권한은 서버 액션이 판정한다.
 */
export default function UploadVersionDialog({
  open,
  onOpenChange,
  attachmentId,
  tabTitle,
  channelId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 탭이 가리키는 첨부(계보 안의 아무 버전) */
  attachmentId: string
  tabTitle: string
  channelId: string
}) {
  const router = useRouter()
  const { state } = useFileVersionState(open ? attachmentId : null)
  const baseId = state?.latestId ?? state?.attachmentId ?? attachmentId
  const latest = state?.versions.find(v => v.id === state.latestId)
  const nextNo = state ? Math.max(0, ...state.versions.map(v => v.versionNo)) + 1 : undefined

  return (
    <SaveVersionDialog
      open={open}
      onOpenChange={onOpenChange}
      channelId={state?.channelId ?? channelId}
      baseAttachmentId={baseId}
      fileName={latest?.name ?? tabTitle}
      nextVersionNo={nextNo}
      onSaved={() => router.refresh()}
    />
  )
}
