import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import { getMemberDocumentUsage, listMemberDocuments } from '@/db/queries/memberDocuments'
import { availableNewDocumentTypes } from '@/lib/memberDocuments/editors'
import { MEMBER_DOCUMENT_QUOTA_BYTES } from '@/lib/memberDocuments/rules'
import { resolveMemberDocumentsViewer } from '@/lib/server/memberDocumentsPage'
import MypageLayout from '../components/MypageLayout'
import DocumentsGate from './_components/DocumentsGate'
import DocumentsList from './_components/DocumentsList'

// 회원 본인의 화면이다 — 정적화하지 않는다(세션 쿠키를 읽는다)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: '내 문서함', robots: { index: false, follow: false } }

const DESCRIPTION =
  '내 문서를 보관하고, 미리 보고, PC에서는 바로 고칠 수 있습니다. 나만 볼 수 있습니다.'

/**
 * 마이페이지 → 내 문서함(docs/board-work/04-조합원-문서함.md). 비로그인은 로그인으로, 미승인·정지는 안내, 기능 스위치가
 * 꺼졌으면 "준비 중". 목록은 쿼리 계층을 `ownerId = 나`로 직접 읽는다.
 */
export default async function MemberDocumentsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const viewer = await resolveMemberDocumentsViewer(locale, '/mypage/documents')
  if (viewer.kind !== 'member') {
    return (
      <MypageLayout title="내 문서함" description={DESCRIPTION}>
        <DocumentsGate state={viewer.kind} />
      </MypageLayout>
    )
  }

  const [documents, usage] = await Promise.all([
    listMemberDocuments(viewer.userId),
    getMemberDocumentUsage(viewer.userId),
  ])
  return (
    <MypageLayout title="내 문서함" description={DESCRIPTION}>
      <DocumentsList
        documents={documents.map(d => ({
          id: d.id,
          name: d.name,
          latestVersionNo: d.latestVersionNo,
          latestVersionId: d.latestVersionId,
          size: d.size,
          totalSize: d.totalSize,
          versionCount: d.versionCount,
          updatedAt: d.updatedAt.toISOString(),
          deletionNotifiedAt: d.deletionNotifiedAt ? d.deletionNotifiedAt.toISOString() : null,
        }))}
        usage={{ ...usage, quota: MEMBER_DOCUMENT_QUOTA_BYTES }}
        newTypes={availableNewDocumentTypes()}
      />
    </MypageLayout>
  )
}
