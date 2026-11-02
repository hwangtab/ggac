import { Badge } from '@work/components/ui/badge'
import { versionLabel, type FileVersionState } from '@work/lib/files/version-rules'

/**
 * 목록·메시지 첨부용 작은 배지: `v3`(2 이상일 때만). 계보 정보만으로 그린다(서버 호출 없음).
 */
export function VersionNumberBadge({ versionNo }: { versionNo: number }) {
  const label = versionLabel(versionNo)
  if (!label) return null
  return (
    <Badge variant="secondary" className="px-1.5" title={`버전 ${versionNo}`}>
      {label}
    </Badge>
  )
}

/** 메시지 타임라인 첨부의 `이전 버전` 표시(최신이 아닌 첨부) */
export function OldVersionBadge() {
  return (
    <Badge variant="outline" className="px-1.5 text-muted-foreground">
      이전 버전
    </Badge>
  )
}

/**
 * 파일 상세·미리보기 머리글의 상태 배지: `v3` · `최신`/`이전 버전` · `최종`(별도 색) · `수정 중 · 홍길동`.
 * 버전이 하나뿐(v1 이고 최신)이면 `최신` 은 군더더기라 생략한다.
 */
export default function VersionBadges({ state }: { state: FileVersionState }) {
  const label = versionLabel(state.versionNo)
  const isLatest = state.latestId === state.attachmentId
  const single = state.versions.length <= 1
  const isFinal = state.finalId === state.attachmentId
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="version-badges">
      {label && <Badge variant="secondary">{label}</Badge>}
      {!single &&
        (isLatest ? (
          <Badge variant="outline">최신</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            이전 버전
          </Badge>
        ))}
      {isFinal && <Badge variant="success">최종</Badge>}
      {state.checkout && (
        <Badge variant="destructive">
          수정 중 · {state.checkout.mine ? '나' : (state.checkout.userName ?? '다른 사용자')}
        </Badge>
      )}
    </span>
  )
}
