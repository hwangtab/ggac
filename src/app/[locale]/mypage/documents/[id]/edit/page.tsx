import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import { getOwnedMemberDocument } from '@/db/queries/memberDocuments'
import { isUuid } from '@/lib/server/memberDocumentsRoute'
import { resolveMemberDocumentsViewer } from '@/lib/server/memberDocumentsPage'
import {
  canOfferHwpEdit,
  getHwpStudioUrl,
  hwpEditFormatOf,
  isHwpFormatEnabled,
} from '@work/lib/files/hwp-editor'
import { canOfferOfficeEdit, getOfficeEditorOrigin } from '@work/lib/files/office-edit'
import MypageLayout from '../../../components/MypageLayout'
import DocumentEditScreen from '../../_components/DocumentEditScreen'
import DocumentsGate from '../../_components/DocumentsGate'
import EditFrame from '../../_components/EditFrame'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: '문서 편집', robots: { index: false, follow: false } }

function Unavailable({ id, message }: { id: string; message: string }) {
  return (
    <EditFrame>
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm">{message}</p>
        <Link href={`/mypage/documents/${id}`} className="tw-btn-secondary">
          문서로 돌아가기
        </Link>
      </div>
    </EditFrame>
  )
}

/**
 * 내 문서 앱 안 편집(docs/board-work/04-조합원-문서함.md §8) — 최신 버전을 연다. 편집기 env 가 없거나 형식·크기가 맞지
 * 않으면 안내, 남의 문서·없는 문서는 404. 실제 차단은 저장 라우트(`/api/mypage/documents/<id>/versions`)가 다시 한다.
 */
export default async function MemberDocumentEditPage({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)
  const viewer = await resolveMemberDocumentsViewer(locale, `/mypage/documents/${id}/edit`)
  if (viewer.kind !== 'member') {
    return (
      <MypageLayout title="내 문서함">
        <DocumentsGate state={viewer.kind} />
      </MypageLayout>
    )
  }
  if (!isUuid(id)) notFound()
  const found = await getOwnedMemberDocument(viewer.userId, id)
  if (!found) notFound()
  const latest = found.versions.find(v => v.versionNo === found.document.latestVersionNo)
  if (!latest) notFound()

  const target = {
    kind: 'existing' as const,
    documentId: id,
    versionId: latest.id,
    versionNo: latest.versionNo,
  }
  const backHref = `/mypage/documents/${id}`

  const hwpFormat = hwpEditFormatOf(latest.name)
  if (hwpFormat) {
    const studioUrl = getHwpStudioUrl()
    if (!studioUrl || !isHwpFormatEnabled(hwpFormat)) {
      return <Unavailable id={id} message="이 배포에서는 한글 문서를 앱에서 편집할 수 없습니다." />
    }
    if (!canOfferHwpEdit({ fileName: latest.name, size: latest.size })) {
      return <Unavailable id={id} message="파일이 20MB를 넘어 앱에서 편집할 수 없습니다." />
    }
    return (
      <EditFrame>
        <DocumentEditScreen
          target={target}
          editor={{ kind: 'hwp', studioUrl, format: hwpFormat }}
          fileName={latest.name}
          backHref={backHref}
        />
      </EditFrame>
    )
  }

  const origin = getOfficeEditorOrigin()
  if (!canOfferOfficeEdit({ fileName: latest.name, size: latest.size, origin }) || !origin) {
    return (
      <Unavailable id={id} message="이 문서는 앱에서 편집할 수 없는 형식이거나 50MB를 넘습니다." />
    )
  }
  return (
    <EditFrame>
      <DocumentEditScreen
        target={target}
        editor={{ kind: 'office', origin }}
        fileName={latest.name}
        backHref={backHref}
      />
    </EditFrame>
  )
}
