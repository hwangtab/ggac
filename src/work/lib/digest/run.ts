import { canAccessBoardRoom } from '@/lib/server/authz'
import { workRoleOf } from '@/lib/server/boardWorkAuth'
import { canReadChannelRow } from '@/lib/server/boardWorkChannelAuth'
import {
  claimDigestSend,
  listDigestCandidates,
  releaseDigestSend,
  type DigestCandidateRow,
} from '@/db/queries/work/digest'
import { buildDigestEmail } from './build'
import { digestMailerFromEnv, type DigestMailer } from './mailer'
import {
  DIGEST_DELAY_MS,
  DIGEST_FIRST_WINDOW_MS,
  groupByRecipient,
  latestCreatedAt,
  selectDigestRows,
} from './select'

/**
 * 멘션·DM 다이제스트 1회 실행 — 원본 kosmart-work `lib/digest/run.ts`. 크론(`/api/internal/board-work/mention-digest`, 매시)이 부른다.
 * 안 읽은 멘션·DM을 사용자별 메일 1통으로 묶는다.
 * - 마지막 발송 이후(work_digest_state) 새 것만. 발송 성공 시 기준을 **담긴 메시지 중 가장 늦은 created_at** 으로 올린다.
 * - 발송 실패(5xx·네트워크·401/403·429)면 기준을 올리지 않아 다음 실행에서 다시 시도한다. 400/422(영구 거부)는 건너뛴 것으로 올린다.
 * - 발송 수단이 없으면(Resend 키 없음) 아무것도 하지 않는다(상태도 그대로).
 *
 * ggac 이식:
 * - 받는 사람 판정에 **이사회 권한·채널 읽기 범위·방해 금지**를 더했다(`select.ts`). 원본은 "활성 staff"만 봤다.
 * - 메일 주소는 `member_profiles.email`이다(원본 auth.admin.getUserById).
 * - 발송 수단을 주입한다(`mailer`). 시험은 captureMailer를, E2E 서버는 `BOARD_WORK_DIGEST_TRANSPORT=log` + 빈 `RESEND_API_KEY`로
 *   실제 메일이 나갈 길을 막는다.
 */

/** Resend 기본 한도(초당 2건)를 넘지 않도록 메일 사이에 두는 간격 */
export const SEND_GAP_MS = 600
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export type DigestRunResult = {
  skipped?: 'resend_not_configured'
  candidates: number
  recipients: number
  sent: number
  failed: number
  noEmail: number
  /** Resend 가 키·도메인 오류(401/403)를 돌려줬다 — 있을 때만 들어간다 */
  authFailed?: true
}

/** 발송 시도가 이 건수 이상이고 실패율이 이 값 이상이면 실행 전체를 실패로 본다(500 → 크론 실패 알림) */
export const DIGEST_FAIL_MIN_ATTEMPTS = 3
export const DIGEST_FAIL_RATE = 0.5

/**
 * 부분 실패가 200 으로 묻히지 않게 — 알릴 만한 실행이면 사유(내용 아님)를, 정상이면 null.
 * 키 오류는 항상, 그 밖엔 시도 3건 이상에서 실패율 50% 이상. 키 미설정은 ggac에서 선택 사항이라 알리지 않는다
 * (원본은 알렸다 — `RESEND_API_KEY`가 ggac에서는 선택 환경변수다).
 */
export function digestRunProblem(r: DigestRunResult): string | null {
  if (r.authFailed) return 'resend_unauthorized'
  const attempts = r.sent + r.failed
  if (attempts >= DIGEST_FAIL_MIN_ATTEMPTS && r.failed / attempts >= DIGEST_FAIL_RATE) {
    return 'high_failure_rate'
  }
  return null
}

/** 받는 사람이 지금 업무툴에 들어올 수 있고 그 채널을 읽을 수 있는가 */
function recipientCanRead(row: DigestCandidateRow): boolean {
  if (!canAccessBoardRoom(row.recipient_profile)) return false
  const role = workRoleOf(row.recipient_profile)
  if (!role) return false
  const kind =
    row.channel_kind === 'private' || row.channel_kind === 'dm' ? row.channel_kind : 'public'
  return canReadChannelRow(
    { userId: row.recipient_id, role },
    { kind, memberRole: row.recipient_member_role }
  )
}

export async function runMentionDigest(
  now: Date = new Date(),
  opts: { sendGapMs?: number; mailer?: DigestMailer | null; siteUrl?: string } = {}
): Promise<DigestRunResult> {
  const sendGapMs = opts.sendGapMs ?? SEND_GAP_MS
  const result: DigestRunResult = { candidates: 0, recipients: 0, sent: 0, failed: 0, noEmail: 0 }
  const mailer = opts.mailer === undefined ? digestMailerFromEnv(process.env) : opts.mailer
  if (!mailer) return { ...result, skipped: 'resend_not_configured' }
  const siteUrl = opts.siteUrl ?? (process.env.NEXT_PUBLIC_SITE_URL || 'https://ggac.kr')

  const raw = await listDigestCandidates({
    cutoff: new Date(now.getTime() - DIGEST_DELAY_MS),
    defaultSince: new Date(now.getTime() - DIGEST_FIRST_WINDOW_MS),
  })
  const rows = selectDigestRows({ rows: raw, now, canAccess: recipientCanRead })
  result.candidates = rows.length

  const groups = groupByRecipient(rows)
  result.recipients = groups.size

  for (const [userId, list] of groups) {
    const email = list[0].recipient_email?.trim()
    if (!email) {
      result.noEmail += 1
      continue
    }
    const mail = buildDigestEmail(list, siteUrl)
    if (!mail) continue

    // 보내기 **전에** 이 묶음을 차지한다 — 겹친 다른 실행이 이미 차지했으면 보내지 않는다(같은 메일 두 통 방지)
    const next = latestCreatedAt(list)
    // 비교 기준은 후보를 뽑을 때 본 값이다(차지 직전에 새로 읽으면 겹친 실행이 올린 값을 보고 또 보낸다)
    const prev = list[0].recipient_digest_last_sent_at
    try {
      if (!(await claimDigestSend(userId, prev, next))) continue
    } catch (e) {
      console.error(
        '[digest] 발송 차지 실패 — 이 사람은 다음 실행에서:',
        e instanceof Error ? e.name : e
      )
      continue
    }
    const release = () =>
      releaseDigestSend(userId, prev, next).catch(e =>
        console.error('[digest] 차지 되돌리기 실패(이 묶음은 다시 보내지 않음):', e)
      )

    const sent = await mailer({
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    })
    // strict:false 라 판별 유니온이 좁혀지지 않는다 — 실패 사유를 먼저 꺼낸다
    const reason = 'reason' in sent ? sent.reason : null
    if (reason) {
      result.failed += 1
      if (reason === 'unauthorized') {
        // 키·도메인 오류는 누구에게 보내도 같다 — 이번 실행을 중단하고 알린다(차지를 되돌려 고친 뒤 이어서 보낸다)
        console.error('[digest] Resend 인증 오류(401/403) — 이번 실행을 중단합니다')
        result.authFailed = true
        await release()
        break
      }
      if (reason === 'rate_limited') {
        // 남은 사람도 같은 한도에 걸린다. 차지를 되돌렸으니 다음 실행에서 이어서 보낸다.
        console.error('[digest] Resend 429 — 이번 실행을 중단합니다')
        await release()
        break
      }
      // 영구 거부(400/422)는 매 실행 같은 요청을 되풀이하지 않게 건너뛴 것으로 둔다(차지 유지). 그 밖의 실패는 되돌려 다음에 다시.
      if (reason !== 'rejected') {
        await release()
        continue
      }
      console.error('[digest] Resend 가 수신을 거부함(400/422) — 이번 묶음은 건너뜁니다')
    } else {
      result.sent += 1
    }
    if (sendGapMs > 0) await sleep(sendGapMs)
  }
  return result
}
