/**
 * 보낸 메일의 보관 기한과 고아 Blob 정리 — 메일함 백필 크론이 매시 부른다.
 *
 * 이 모듈은 Blob 저장소를 **주입**받는다(`BlobOps`). 실제 저장소 없이 테스트하기 위해서이고, 서버에서는
 * `defaultBlobOps()`가 비공개 저장소를 쓴다. 상대 경로 import(`.ts`)를 쓰는 이유는 테스트가 직접
 * import하기 때문이다(`ingestInbound.ts`와 같은 제약).
 *
 * ## 정책
 * - **보내지 못한 메일(`failed`·`blocked`)**: 기본 30일 뒤 행과 첨부를 지운다. 나가지 않은 메일의 본문·
 *   수신자를 오래 들고 있을 이유가 없다. `MAILBOX_OUTBOUND_FAILED_RETENTION_DAYS`로 바꾼다(최소 7).
 * - **나간 메일(`sent`)**: **기본은 지우지 않는다.** 무엇을 누구에게 보냈는지는 감사 기록이라 보관 기간은
 *   조직이 정할 일이다. `MAILBOX_OUTBOUND_RETENTION_DAYS`를 설정하면 그 기간 뒤 행과 첨부를 지운다(최소 7).
 * - **`unknown`·`sending`은 어떤 기한으로도 지우지 않는다.** 사람이 Resend로 확인해 확정하기 전의 행이다.
 * - **고아 Blob**: `mailbox-sent/` 아래에 있지만 DB 어디에도 참조되지 않는 파일(업로드 직후 함수가 죽었거나,
 *   삭제 실패로 행만 지워진 경우). 올라온 지 24시간이 지난 것만 지운다 — 지금 업로드 중인 요청의 파일을
 *   지우지 않기 위해서다.
 *
 * 한 번에 처리하는 양을 제한한다(크론 시간 제한). 남은 것은 다음 실행이 이어서 한다.
 */
import { deleteObject, listObjects } from '../storage/blob.ts'
import {
  MAILBOX_SENT_ATTACHMENT_PREFIX,
  isSafeSentMailboxAttachmentPath,
} from '../storage/mailboxAttachments.ts'
import {
  deleteOutboundEmailsReturningPaths,
  filterUnreferencedSentPaths,
  listOutboundIdsForPurge,
} from '../../db/queries/mailbox.ts'

const DAY_MS = 24 * 60 * 60 * 1000
export const MIN_RETENTION_DAYS = 7
export const DEFAULT_FAILED_RETENTION_DAYS = 30
/** 올라온 지 이 시간이 안 된 고아 후보는 건드리지 않는다. */
export const ORPHAN_MIN_AGE_MS = DAY_MS
const PURGE_BATCH = 100
const ORPHAN_LIST_LIMIT = 1000
const ORPHAN_DELETE_LIMIT = 100
/**
 * 차단기: 오래된 후보가 이만큼 이상인데 그중 이 비율보다 많이 "참조 없음"이면 **삭제하지 않고 멈춘다.**
 * 정상 운영에서 고아는 드물다(업로드 직후 함수가 죽은 경우 정도). 다수가 한꺼번에 고아로 보인다는 것은
 * DB와 Blob 저장소가 서로 다른 환경을 가리키거나(예: 테스트 서버가 운영 토큰을 쥔 경우) DB 조회가
 * 잘못됐다는 신호다 — 그때 "지운다"는 데이터 손실이다.
 */
export const ORPHAN_BREAKER_MIN_CANDIDATES = 5
export const ORPHAN_BREAKER_MAX_RATIO = 0.5

/**
 * 이 환경에서 정리를 돌려도 되는가. **운영 배포(`VERCEL_ENV=production`)에서만 켠다.** 로컬·E2E·프리뷰는
 * Blob 저장소와 DB가 같은 환경을 가리킨다는 보장이 없어, 거기서 도는 정리는 다른 환경의 파일을 지울 수 있다.
 */
export function sweepAllowedHere(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production'
}

export type SweepConfig = {
  failedRetentionDays: number
  /** null이면 나간 메일은 지우지 않는다. */
  sentRetentionDays: number | null
}

export type BlobOps = {
  list(prefix: string, limit: number): Promise<{ pathname: string; uploadedAt: Date }[]>
  remove(pathname: string): Promise<void>
}

export function defaultBlobOps(): BlobOps {
  return {
    list: (prefix, limit) => listObjects('private', prefix, limit),
    remove: pathname => deleteObject('private', pathname),
  }
}

function days(raw: string | undefined): number | null {
  const text = raw?.trim()
  if (!text) return null
  const n = Number(text)
  if (!Number.isInteger(n) || n <= 0) return null
  return Math.max(n, MIN_RETENTION_DAYS)
}

export function sweepConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): SweepConfig {
  return {
    failedRetentionDays:
      days(env.MAILBOX_OUTBOUND_FAILED_RETENTION_DAYS) ?? DEFAULT_FAILED_RETENTION_DAYS,
    sentRetentionDays: days(env.MAILBOX_OUTBOUND_RETENTION_DAYS),
  }
}

export type SweepResult = {
  purgedRows: number
  purgedBlobs: number
  blobDeleteFailures: number
  orphanBlobsDeleted: number
  /** 차단기가 걸려 고아 삭제를 건너뛰었으면 사유. */
  orphanSweepAborted: 'high_orphan_ratio' | null
}

async function purge(
  statuses: string[],
  olderThanMs: number,
  blob: BlobOps,
  result: SweepResult
): Promise<void> {
  const ids = await listOutboundIdsForPurge(statuses, olderThanMs, PURGE_BATCH)
  if (ids.length === 0) return

  // **행을 먼저, 조건부로 지우고 그때 실제로 지워진 행의 첨부 경로만 받는다.** Blob을 먼저 지우면 그 사이
  // 상태가 바뀐 행(예: 운영자가 확정)의 첨부만 사라지고 행은 남는다. 이 순서면 어느 단계에서 죽어도 최악은
  // "행은 없고 파일이 남는" 고아이고, 그건 아래 고아 정리가 24시간 뒤 치운다.
  const { deletedCount, blobPaths } = await deleteOutboundEmailsReturningPaths(ids, statuses)
  result.purgedRows += deletedCount

  for (const path of blobPaths.filter(isSafeSentMailboxAttachmentPath)) {
    try {
      await blob.remove(path)
      result.purgedBlobs += 1
    } catch {
      // 행은 지우고 이 파일은 고아가 된다 — 다음 실행의 고아 정리가 24시간 뒤 치운다.
      result.blobDeleteFailures += 1
    }
  }
}

export async function sweepOutbound(
  now: number,
  config: SweepConfig,
  blob: BlobOps
): Promise<SweepResult> {
  const result: SweepResult = {
    purgedRows: 0,
    purgedBlobs: 0,
    blobDeleteFailures: 0,
    orphanBlobsDeleted: 0,
    orphanSweepAborted: null,
  }

  await purge(['failed', 'blocked'], now - config.failedRetentionDays * DAY_MS, blob, result)
  if (config.sentRetentionDays !== null) {
    await purge(['sent'], now - config.sentRetentionDays * DAY_MS, blob, result)
  }

  // 고아 Blob. 접두어 아래만 본다 — 다른 접두어(`mailbox/`·`backups/` 등)는 절대 건드리지 않는다.
  const listed = await blob.list(`${MAILBOX_SENT_ATTACHMENT_PREFIX}/`, ORPHAN_LIST_LIMIT)
  const old = listed.filter(
    b =>
      isSafeSentMailboxAttachmentPath(b.pathname) &&
      now - b.uploadedAt.getTime() > ORPHAN_MIN_AGE_MS
  )
  const unreferenced = await filterUnreferencedSentPaths(old.map(b => b.pathname))
  if (
    old.length >= ORPHAN_BREAKER_MIN_CANDIDATES &&
    unreferenced.length / old.length > ORPHAN_BREAKER_MAX_RATIO
  ) {
    result.orphanSweepAborted = 'high_orphan_ratio'
    return result
  }
  const orphans = unreferenced.slice(0, ORPHAN_DELETE_LIMIT)
  for (const path of orphans) {
    try {
      await blob.remove(path)
      result.orphanBlobsDeleted += 1
    } catch {
      result.blobDeleteFailures += 1
    }
  }

  return result
}
