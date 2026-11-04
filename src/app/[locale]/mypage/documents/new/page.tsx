import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import { availableNewDocumentTypes } from '@/lib/memberDocuments/editors'
import {
  MEMBER_NEW_DOCUMENT_TYPES,
  isMemberNewDocumentType,
  newDocumentTemplatePath,
  normalizeNewDocumentName,
} from '@/lib/memberDocuments/rules'
import { resolveMemberDocumentsViewer } from '@/lib/server/memberDocumentsPage'
import { getHwpStudioUrl } from '@work/lib/files/hwp-editor'
import { getOfficeEditorOrigin } from '@work/lib/files/office-edit'
import { formatDay } from '@work/lib/format/datetime'
import MypageLayout from '../../components/MypageLayout'
import DocumentEditScreen from '../_components/DocumentEditScreen'
import DocumentsGate from '../_components/DocumentsGate'
import EditFrame from '../_components/EditFrame'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: '새 문서', robots: { index: false, follow: false } }

/**
 * `/mypage/documents/new?type=docx|xlsx|pptx|hwpx[&name=<이름>]` — 빈 서식(public/doc-templates)으로 편집기를 열고, 처음
 * 저장할 때 문서(v1)가 생긴다(docs/board-work/04-조합원-문서함.md §8). 형식이 이 배포에서 꺼져 있으면 404.
 */
export default async function MemberNewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const viewer = await resolveMemberDocumentsViewer(locale, '/mypage/documents')
  if (viewer.kind !== 'member') {
    return (
      <MypageLayout title="내 문서함">
        <DocumentsGate state={viewer.kind} />
      </MypageLayout>
    )
  }
  const raw = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const type = first(raw.type)
  if (!isMemberNewDocumentType(type)) notFound()
  if (!availableNewDocumentTypes().some(t => t.type === type)) notFound()

  const info = MEMBER_NEW_DOCUMENT_TYPES.find(t => t.type === type)
  const now = new Date()
  const fileName =
    normalizeNewDocumentName(first(raw.name) ?? '', type) ??
    `${info?.defaultName ?? '새 문서'} ${formatDay(now, now)}.${type}`
  const target = { kind: 'new' as const, templatePath: newDocumentTemplatePath(type) }

  if (type === 'hwpx') {
    const studioUrl = getHwpStudioUrl()
    if (!studioUrl) notFound()
    return (
      <EditFrame>
        <DocumentEditScreen
          target={target}
          editor={{ kind: 'hwp', studioUrl, format: 'hwpx' }}
          fileName={fileName}
          backHref="/mypage/documents"
        />
      </EditFrame>
    )
  }
  const origin = getOfficeEditorOrigin()
  if (!origin) notFound()
  return (
    <EditFrame>
      <DocumentEditScreen
        target={target}
        editor={{ kind: 'office', origin }}
        fileName={fileName}
        backHref="/mypage/documents"
      />
    </EditFrame>
  )
}
