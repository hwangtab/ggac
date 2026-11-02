import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import HwpEditScreen from '@work/components/files/hwp-edit/HwpEditScreen'
import DesktopOnlyGate from '@work/components/files/office-edit/DesktopOnlyGate'
import OfficeEditScreen from '@work/components/files/office-edit/OfficeEditScreen'
import {
  canOfferHwpEdit,
  getHwpStudioUrl,
  hwpEditFormatOf,
  isHwpFormatEnabled,
} from '@work/lib/files/hwp-editor'
import {
  OFFICE_EDIT_MAX_BYTES,
  getOfficeEditorOrigin,
  isOfficeEditFile,
} from '@work/lib/files/office-edit'
import { listFileVersions } from '@work/lib/files/version-actions'
import Denied from '../denied'

export const metadata: Metadata = { title: '문서 편집' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `/board-room/edit/[attachmentId]` — 원본 kosmart-work `app/edit/[attachmentId]/page.tsx`. Word·Excel·PPT 앱 편집(docs/11) · HWP(.hwp)·HWPX(.hwpx) 앱 편집(docs/12·18). 편집기 출처 env 가 없으면 404.
 * 읽을 수 없는 파일(비멤버 비공개 채널 등)은 404, 읽을 수는 있으나 편집 권한이 없으면(게스트·비멤버·보관 채널·삭제된 게시물) 안내 화면.
 * 실제 차단은 저장 시 서버 액션(saveFileVersion·checkoutFile)이 다시 한다.
 */
export default async function EditPage({ params }: { params: Promise<{ attachmentId: string }> }) {
  await requireWorkStaff()
  const { attachmentId } = await params
  const origin = getOfficeEditorOrigin()
  if (!origin || !UUID.test(attachmentId)) notFound()

  const res = await listFileVersions({ attachmentId })
  if (!res.ok) notFound()
  const state = res.data
  const current = state.versions.find(v => v.id === state.attachmentId)
  if (!current) notFound()

  if (!state.canEdit) return <Denied message="이 파일을 편집할 권한이 없습니다." />
  const nextNo = Math.max(0, ...state.versions.map(v => v.versionNo)) + 1

  // HWP(.hwp)·HWPX(.hwpx) 앱 안 편집(docs/12·18). env 가 꺼져 있으면 이 분기를 건너뛰어 "편집할 수 없는 형식" 안내가 된다
  // (.hwpx 는 HWP 편집 env 에 더해 NEXT_PUBLIC_HWPX_EDITOR_ENABLED=1 이 있어야 한다)
  const studioUrl = getHwpStudioUrl()
  const hwpFormat = hwpEditFormatOf(current.name)
  if (studioUrl && hwpFormat && isHwpFormatEnabled(hwpFormat)) {
    if (!canOfferHwpEdit({ fileName: current.name, size: current.size })) {
      return <Denied message="파일이 20MB를 넘어 앱에서 편집할 수 없습니다." />
    }
    return (
      <DesktopOnlyGate>
        <HwpEditScreen
          attachmentId={state.attachmentId}
          fileName={current.name}
          channelId={state.channelId}
          versionNo={current.versionNo}
          nextVersionNo={nextNo}
          studioUrl={studioUrl}
          format={hwpFormat}
        />
      </DesktopOnlyGate>
    )
  }

  if (!isOfficeEditFile(current.name)) {
    return <Denied message="앱에서 편집할 수 없는 형식입니다." />
  }
  if (current.size > OFFICE_EDIT_MAX_BYTES) {
    return <Denied message="파일이 50MB를 넘어 앱에서 편집할 수 없습니다." />
  }

  return (
    <DesktopOnlyGate>
      <OfficeEditScreen
        attachmentId={state.attachmentId}
        fileName={current.name}
        channelId={state.channelId}
        versionNo={current.versionNo}
        nextVersionNo={nextNo}
        origin={origin}
      />
    </DesktopOnlyGate>
  )
}
