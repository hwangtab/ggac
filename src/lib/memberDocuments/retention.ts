import { createBulkNotifications, createNotification } from '@/db/queries/notifications'
import {
  claimExpiredMemberDocument,
  clearDeletionNotified,
  claimMemberDocumentUploadRows,
  findReferencedMemberDocumentPaths,
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
import { listMemberDocumentObjectsPage, removeMemberDocumentObjects } from './storage'

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
  /** 행 없이 저장소에만 남은 문서함 객체를 지운 수(고아 청소) */
  orphansRemoved: number
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
    orphansRemoved: 0,
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
      // 알리지 못했으면 알림 시각을 되돌린다 — 그대로 두면 주인이 모르는 채 30일 뒤 지워진다. 다음 실행이 다시 알린다.
      const reverted = await clearDeletionNotified(
        docs.map(d => d.id),
        now
      ).catch(() => 0)
      result.notifiedDocuments -= reverted
      continue
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
    // 행을 **먼저** 조건부로 지운다(그 사이 열었으면 남기고 객체도 건드리지 않는다). 객체를 먼저 지우면 그 사이 연 문서의
    // 행만 남고 파일이 사라졌다(2026-11-05 리뷰). 행을 지운 뒤 객체 삭제가 실패하면 고아 객체가 남을 뿐 화면은 깨지지 않는다.
    let claimed: Awaited<ReturnType<typeof claimExpiredMemberDocument>>
    try {
      claimed = await claimExpiredMemberDocument(doc.id, now)
    } catch {
      log.error('보존 삭제 — 행을 지우지 못해 미룸', { id: doc.id })
      result.deferredDocuments++
      continue
    }
    if (!claimed) continue
    deleted.push({ ownerId: doc.ownerId, name: doc.name })
    result.deletedDocuments++
    const paths = claimed.blobPaths.filter(
      p => isSafeMemberDocumentPath(p) && p.split('/')[1] === doc.ownerId
    )
    try {
      await removeMemberDocumentObjects(paths)
    } catch (e) {
      if (!(e instanceof StorageUnconfiguredError)) {
        log.error('보존 삭제 — 행은 지웠고 객체 일부를 지우지 못함(고아 객체)', {
          id: doc.id,
          count: paths.length,
        })
      }
    }
    await removeMemberDocumentRenderCaches(claimed.versionIds).catch(() => 0)
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

  // 3. 오래된 임시 업로드 — 행을 먼저 지우고 실제로 지운 행의 객체만 지운다(그 사이 승격된 업로드의 객체를 건드리지 않게).
  //    객체 삭제가 실패하면 고아 객체가 남고 아래 4가 다음 실행에 치운다.
  const stale = await listExpiredMemberDocumentUploads(now, RETENTION_PENDING_BATCH)
  if (stale.length > 0) {
    const gonePaths = await claimMemberDocumentUploadRows(stale.map(s => s.id))
    result.purgedUploads = gonePaths.length
    const removable = gonePaths.filter(p => isSafeMemberDocumentPath(p))
    if (removable.length > 0) {
      await removeMemberDocumentObjects(removable).catch(e => {
        if (!(e instanceof StorageUnconfiguredError)) {
          log.error('오래된 임시 업로드 객체 정리 실패 — 고아 청소가 다음에 치운다')
        }
      })
    }
  }

  // 4. 고아 청소 — 행이 하나도 가리키지 않는 `member-documents/` 객체(행을 먼저 지운 뒤 객체 삭제가 실패한 보존 삭제·탈퇴·
  //    폐기의 흔적). 업무툴과 달리 문서함에는 이 청소가 없어, 실패하면 개인 파일이 영영 남았다(2026-11-05 회귀 리뷰).
  //    올린 지 48시간이 지난 것만 본다(올리는 중·승격 전인 업로드를 지우지 않게 — 임시 업로드는 24시간이면 행째 정리된다).
  try {
    result.orphansRemoved = await sweepMemberDocumentOrphans(now)
  } catch (e) {
    log.error('문서함 고아 청소 실패 — 다음 실행에 다시', {
      error: e instanceof Error ? e.name : typeof e,
    })
  }

  if (
    result.notifiedDocuments ||
    result.deletedDocuments ||
    result.purgedUploads ||
    result.orphansRemoved
  ) {
    log.info('내 문서함 보존 정리', result)
  }
  return result
}

const ORPHAN_MIN_AGE_MS = 48 * 3600 * 1000
const ORPHAN_MAX_PAGES = 20
const ORPHAN_MAX_REMOVALS = 500

/** 행 없는 문서함 객체를 지운다. 지운 수. 훑는 양·지우는 양에 상한 — 남은 건 다음 실행이 이어서 한다 */
export async function sweepMemberDocumentOrphans(
  now: Date,
  deps: {
    listPage?: typeof listMemberDocumentObjectsPage
    findReferenced?: typeof findReferencedMemberDocumentPaths
    remove?: (paths: string[]) => Promise<void>
  } = {}
): Promise<number> {
  const listPage = deps.listPage ?? listMemberDocumentObjectsPage
  const findReferenced = deps.findReferenced ?? findReferencedMemberDocumentPaths
  const remove = deps.remove ?? removeMemberDocumentObjects
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS
  let removed = 0
  let cursor: string | undefined
  for (let page = 0; page < ORPHAN_MAX_PAGES && removed < ORPHAN_MAX_REMOVALS; page++) {
    const res = await listPage(cursor)
    const old = res.objects
      .filter(o => isSafeMemberDocumentPath(o.pathname))
      .filter(o => Number.isFinite(o.uploadedAt.getTime()) && o.uploadedAt.getTime() < cutoff)
      .map(o => o.pathname)
    if (old.length > 0) {
      const referenced = await findReferenced(old)
      const orphans = old.filter(p => !referenced.has(p)).slice(0, ORPHAN_MAX_REMOVALS - removed)
      if (orphans.length > 0) {
        await remove(orphans)
        removed += orphans.length
      }
    }
    if (!res.hasMore || !res.cursor) break
    cursor = res.cursor
  }
  return removed
}
