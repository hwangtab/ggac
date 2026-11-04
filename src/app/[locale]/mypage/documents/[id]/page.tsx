import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import { getOwnedMemberDocument, touchOwnedMemberDocument } from '@/db/queries/memberDocuments'
import { canEditMemberDocument } from '@/lib/memberDocuments/editors'
import { versionView } from '@/lib/memberDocuments/service'
import { isUuid } from '@/lib/server/memberDocumentsRoute'
import { resolveMemberDocumentsViewer } from '@/lib/server/memberDocumentsPage'
import MypageLayout from '../../components/MypageLayout'
import DocumentDetail from '../_components/DocumentDetail'
import DocumentsGate from '../_components/DocumentsGate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: '내 문서', robots: { index: false, follow: false } }

/**
 * 내 문서 하나 — 미리보기·버전 기록·관리(docs/board-work/04-조합원-문서함.md §8). 남의 문서·없는 문서는 404(존재를 알리지
 * 않는다). 화면을 연 것은 열람으로 센다(보존 시계를 처음부터 — §6).
 */
export default async function MemberDocumentPage({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)
  const viewer = await resolveMemberDocumentsViewer(locale, `/mypage/documents/${id}`)
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
  await touchOwnedMemberDocument(viewer.userId, id).catch(() => false)

  const latest = found.versions.find(v => v.versionNo === found.document.latestVersionNo)
  return (
    <MypageLayout title="내 문서함">
      <DocumentDetail
        document={{
          id: found.document.id,
          name: found.document.name,
          latestVersionNo: found.document.latestVersionNo,
          updatedAt: found.document.updatedAt.toISOString(),
        }}
        versions={found.versions.map(versionView)}
        canEdit={latest ? canEditMemberDocument(latest.name, latest.size) : false}
      />
    </MypageLayout>
  )
}
