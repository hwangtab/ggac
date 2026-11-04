import { createBulkNotifications, createNotification } from '@/db/queries/notifications'
import {
  deleteExpiredMemberDocument,
  deleteMemberDocumentUploadRows,
  listExpiredMemberDocumentUploads,
  listRetentionDeleteCandidates,
  listRetentionNotifyCandidates,
  markDeletionNotified,
} from '@/db/queries/memberDocuments'
import { getProfileEmail } from '@/db/queries/profiles'
import { isSendableEmail, renderNoticeEmail } from '@/lib/funding/notifyContent'
import { sendEmail } from '@/lib/mail/send'
import { isSafeMemberDocumentPath } from '@/lib/storage/memberDocuments'
import { StorageUnconfiguredError } from '@work/lib/files/private-store'
import { createLogger } from '@/utils/logger'
import { getSiteUrl } from '@/utils/site'
import { deletionDueAt } from './rules'
import { removeMemberDocumentRenderCaches } from './service'
import { removeMemberDocumentObjects } from './storage'

const log = createLogger('member-documents/retention')

/** 한 번에 다루는 최대 건수 — 남으면 다음 날 이어서 한다 */
export const RETENTION_NOTIFY_BATCH = 200
export const RETENTION_DELETE_BATCH = 100
export const RETENTION_PENDING_BATCH = 200

export type RetentionRunResult = {
  notifiedDocuments: number
  notifiedOwners: number
  emailed: number
  deletedDocuments: number
  /** 객체를 못 지워 다음 실행으로 미룬 문서 */
  deferredDocuments: number
  purgedUploads: number
}

function formatKstDate(d: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d)
}

function groupByOwner<T extends { ownerId: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) m.set(r.ownerId, [...(m.get(r.ownerId) ?? []), r])
  return m
}

function namesLine(names: string[]): string {
  const shown = names.slice(0, 3).map(n => `‘${n}’`)
  return names.length > 3 ? `${shown.join(', ')} 외 ${names.length - 3}건` : shown.join(', ')
}

/**
 * 보존 크론 한 번(docs/board-work/04-조합원-문서함.md §6) — 라우트(`/api/internal/member-documents/retention`)가
 * `CRON_SECRET`을 확인한 뒤에 부른다. 순서:
 *  1. 알림: 1년 동안 열지 않은 문서에 알림 시각을 남기고(그 사이 연 문서는 쿼리가 건너뛴다) 사람마다 알림 한 건 + 메일 한 통.
 *  2. 삭제: 알린 지 30일이 지나도 열지 않은 문서의 객체 → 캐시 → 행(조건을 다시 걸어 지운다 — 그 사이 열면 남긴다).
 *     객체를 못 지우면 행을 남겨 다음 실행이 다시 한다. 사람마다 삭제 통지 알림 한 건.
 *  3. 24시간이 지난 임시 업로드의 객체·행.
 * 문서 이름은 알림·메일에만 싣고 로그에는 남기지 않는다.
 */
export async function runMemberDocumentRetention(
  now: Date = new Date()
): Promise<RetentionRunResult> {
  const result: RetentionRunResult = {
    notifiedDocuments: 0,
    notifiedOwners: 0,
    emailed: 0,
    deletedDocuments: 0,
    deferredDocuments: 0,
    purgedUploads: 0,
  }
  const siteUrl = getSiteUrl().replace(/\/$/, '')
  const listUrl = `${siteUrl}/ko/mypage/documents`

  // 1. 알림
  const candidates = await listRetentionNotifyCandidates(now, RETENTION_NOTIFY_BATCH)
  const marked = new Set(
    await markDeletionNotified(
      candidates.map(c => c.id),
      now
    )
  )
  const notified = candidates.filter(c => marked.has(c.id))
  result.notifiedDocuments = notified.length
  const due = formatKstDate(deletionDueAt(now))
  const mailReady =
    typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY !== ''
  for (const [ownerId, docs] of groupByOwner(notified)) {
    const names = docs.map(d => d.name)
    const notice = {
      title: '열지 않은 문서가 곧 지워집니다',
      message: `내 문서함의 ${namesLine(names)}을(를) 1년 동안 열지 않았습니다. ${due}까지 한 번도 열지 않으면 자동으로 지워집니다. 계속 보관하려면 문서를 한 번 열어 주세요.`,
      url: listUrl,
      cta: '내 문서함 열기',
      data: { url: '/mypage/documents', count: docs.length, scope: 'member_documents' },
    }
    try {
      await createNotification({
        user_id: ownerId,
        type: 'member_document_expiring',
        title: notice.title,
        message: notice.message,
        data: { url: '/mypage/documents', count: docs.length, scope: 'member_documents' },
      })
      result.notifiedOwners++
    } catch (e) {
      log.error('삭제 예고 알림 실패', { error: e instanceof Error ? e.message : String(e) })
    }
    if (!mailReady) continue
    try {
      const to = await getProfileEmail(ownerId)
      if (!isSendableEmail(to)) continue
      const { subject, html } = renderNoticeEmail(notice)
      await sendEmail({ to, subject, html })
      result.emailed++
    } catch (e) {
      log.error('삭제 예고 메일 실패', { error: e instanceof Error ? e.message : String(e) })
    }
  }
  if (!mailReady && notified.length > 0) log.warn('RESEND_API_KEY가 없어 삭제 예고 메일을 건너뜀')

  // 2. 삭제
  const expired = await listRetentionDeleteCandidates(now, RETENTION_DELETE_BATCH)
  const deleted: { ownerId: string; name: string }[] = []
  for (const doc of expired) {
    // 경로가 하나라도 규약 밖이면 그 문서는 건드리지 않는다(행이 남아 다음 실행·사람이 본다)
    if (doc.blobPaths.some(p => !isSafeMemberDocumentPath(p) || p.split('/')[1] !== doc.ownerId)) {
      log.error('규약 밖 경로를 가진 문서 — 보존 삭제를 건너뜀', { id: doc.id })
      result.deferredDocuments++
      continue
    }
    try {
      await removeMemberDocumentObjects(doc.blobPaths)
    } catch (e) {
      if (!(e instanceof StorageUnconfiguredError)) {
        log.error('보존 삭제 — 객체를 지우지 못해 미룸', { id: doc.id })
        result.deferredDocuments++
        continue
      }
    }
    if (await deleteExpiredMemberDocument(doc.id, now)) {
      deleted.push({ ownerId: doc.ownerId, name: doc.name })
      result.deletedDocuments++
      await removeMemberDocumentRenderCaches(doc.versionIds).catch(() => 0)
    }
  }
  for (const [ownerId, docs] of groupByOwner(deleted)) {
    try {
      await createBulkNotifications({
        user_ids: [ownerId],
        type: 'member_document_deleted',
        title: '오래 열지 않은 문서를 지웠습니다',
        message: `알려 드린 대로 내 문서함의 ${namesLine(docs.map(d => d.name))}을(를) 지웠습니다.`,
        data: { url: '/mypage/documents', count: docs.length, scope: 'member_documents' },
      })
    } catch (e) {
      log.error('삭제 통지 알림 실패', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  // 3. 오래된 임시 업로드
  const stale = await listExpiredMemberDocumentUploads(now, RETENTION_PENDING_BATCH)
  const removable = stale.filter(s => isSafeMemberDocumentPath(s.blobPath))
  if (removable.length > 0) {
    let objectsGone = true
    try {
      await removeMemberDocumentObjects(removable.map(s => s.blobPath))
    } catch (e) {
      objectsGone = e instanceof StorageUnconfiguredError
      if (!objectsGone) log.error('오래된 임시 업로드 객체 정리 실패 — 다음 실행에 다시')
    }
    if (objectsGone)
      result.purgedUploads = await deleteMemberDocumentUploadRows(removable.map(s => s.id))
  }

  if (result.notifiedDocuments || result.deletedDocuments || result.purgedUploads) {
    log.info('내 문서함 보존 정리', result)
  }
  return result
}
