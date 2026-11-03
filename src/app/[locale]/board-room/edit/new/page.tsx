import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { listLineageVersions, findOwnMessageAttachment } from '@/db/queries/work/versions'
import { fetchMessageRecord } from '@/db/queries/work/messages'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import HwpEditScreen from '@work/components/files/hwp-edit/HwpEditScreen'
import DesktopOnlyGate from '@work/components/files/office-edit/DesktopOnlyGate'
import OfficeEditScreen from '@work/components/files/office-edit/OfficeEditScreen'
import { checkCreateAccess, PARENT_NOT_FOUND } from '@work/lib/files/create-access-check'
import { pickLatest } from '@work/lib/files/version-rules'
import {
  createDocumentQuerySchema,
  defaultDocumentName,
  hwpxTemplateInfo,
  normalizeCreateFileName,
  normalizeCreateFolder,
} from '@work/lib/files/create-rules'
import { getHwpStudioUrl, isHwpxEditorEnabled } from '@work/lib/files/hwp-editor'
import { getOfficeEditorOrigin } from '@work/lib/files/office-edit'
import { conversationBasePath } from '@work/lib/tabs/paths'
import Denied from '../denied'

export const metadata: Metadata = { title: '새 문서' }
export const dynamic = 'force-dynamic'

/**
 * `/board-room/edit/new?channel=<id>&type=docx|xlsx|pptx|hwpx&name=<이름>[&template=blank][&folder=<path>][&parent=<messageId>][&id=<게시물 id>]` — 새 문서 만들기(docs/16 §3 · docs/18).
 * 원본 kosmart-work `app/edit/new/page.tsx`. 파일은 이 화면에서 처음 저장할 때 생긴다. type=hwpx 는 rhwp 편집기(두 플래그 필요)에서 정적 서식(template)으로 시작한다.
 * 편집기 출처 env(hwpx 는 두 플래그)가 없거나 쿼리가 틀리거나 채널을 읽을 수 없으면 404,
 * 읽을 수는 있으나 만들 수 없으면(서브관리자·비멤버·보관 채널·공지 채널 최상위) 안내 화면. 실제 차단은 createDocument 가 다시 한다.
 */
export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const origin = getOfficeEditorOrigin()

  const raw = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const parsed = createDocumentQuerySchema.safeParse({
    channel: first(raw.channel),
    type: first(raw.type),
    template: first(raw.template),
    name: first(raw.name),
    folder: first(raw.folder),
    parent: first(raw.parent),
    id: first(raw.id),
  })
  if (!parsed.success) notFound()
  const q = parsed.data
  // 오피스 종류는 편집기 출처, 한글 문서(HWPX)는 rhwp 편집기(HWP·HWPX 두 플래그)가 있어야 한다
  const studioUrl = q.type === 'hwpx' && isHwpxEditorEnabled() ? getHwpStudioUrl() : null
  if (q.type === 'hwpx' ? !studioUrl : !origin) notFound()

  // 채널 읽기(아니면 404) → 만들기 권한(서브관리자·비멤버·보관·공지 채널 최상위 — 안내) → 스레드 부모(안내)
  const access = await checkCreateAccess(ctx, q.channel, q.parent)
  if (!access.ok || !access.channel) {
    if (access.reason === 'forbidden' || access.message === PARENT_NOT_FOUND) {
      return <Denied message={access.message ?? '새 문서를 만들 수 없습니다.'} />
    }
    notFound()
  }
  const channel = access.channel

  // 이미 첫 저장을 마친 주소(새로고침·뒤로 가기로 다시 열림) — 그 문서의 최신 버전 편집 화면으로 보낸다.
  // 서버에서 redirect 하지 않고 화면이 처음 그려질 때만 옮긴다: 첫 저장 직후 서버 액션이 이 페이지를 다시 그릴 때
  // redirect 하면 편집 중인 화면이 통째로 바뀐다.
  let createdAttachmentId: string | null = null
  if (q.id) {
    const msg = await fetchMessageRecord(q.id, new Set([channel.id]))
    const taken = msg ?? null
    if (taken) {
      if (taken.author_id !== user.id || taken.channel_id !== channel.id) {
        return <Denied message="이 새 문서 주소는 이미 사용되었습니다. 다시 만들어 주세요." />
      }
      const first = await findOwnMessageAttachment(taken.id, user.id, channel.id)
      if (first) {
        const lineage = await listLineageVersions(first.id, new Set([channel.id]))
        const latest = pickLatest(lineage.map(r => ({ ...r, deleted: r.message_deleted })))
        createdAttachmentId = latest?.id ?? first.id
      }
    }
  }

  const fileName =
    normalizeCreateFileName(q.name ?? '', q.type) ?? `${defaultDocumentName(q.type)}.${q.type}`
  const folder = normalizeCreateFolder(q.folder)
  const base = conversationBasePath(channel)
  // 돌아갈 곳: 스레드면 그 스레드, 폴더가 있는 채널이면 파일 탭의 그 폴더
  const backHref = q.parent
    ? `${base}?thread=${q.parent}`
    : folder && channel.kind !== 'dm'
      ? `${base}/files?path=${encodeURIComponent(folder)}`
      : base

  if (q.type === 'hwpx') {
    if (!studioUrl) notFound()
    return (
      <DesktopOnlyGate backHref={backHref}>
        <HwpEditScreen
          attachmentId={null}
          fileName={fileName}
          channelId={channel.id}
          versionNo={1}
          nextVersionNo={2}
          studioUrl={studioUrl}
          format="hwpx"
          newDocument={{
            templatePath: hwpxTemplateInfo(q.template).templatePath,
            folderPath: folder,
            parentId: q.parent ?? null,
            backHref,
            messageId: q.id,
            createdAttachmentId,
          }}
        />
      </DesktopOnlyGate>
    )
  }
  if (!origin) notFound()

  return (
    <DesktopOnlyGate backHref={backHref}>
      <OfficeEditScreen
        attachmentId={null}
        fileName={fileName}
        channelId={channel.id}
        versionNo={1}
        nextVersionNo={2}
        origin={origin}
        newDocument={{
          type: q.type,
          folderPath: folder,
          parentId: q.parent ?? null,
          backHref,
          messageId: q.id,
          createdAttachmentId,
        }}
      />
    </DesktopOnlyGate>
  )
}
