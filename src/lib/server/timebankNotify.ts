// 상대경로 + 명시적 확장자로 임포트한다(`marketNotify.ts`와 같은 이유 —
// `scripts/testing/timebankNotify.test.mjs`가 plain `node --test`로 직접 부른다).
import { COOP_ACCOUNT, type TimebankKind } from '../../constants/timebank.ts'
import { createBulkNotifications } from '../../db/queries/notifications.ts'
import type { TransferRow } from '../../db/queries/timebankLedger.ts'
import { createLogger } from '../../utils/logger.ts'
import { formatMinutes } from '../timebank/format.ts'
import { pickMarketCommentRecipients } from './marketNotify.ts'

/**
 * 타임뱅크 알림(스펙 §10). 받는 사람과 이동 경로의 표는 스펙에 있고, 이동은
 * `src/utils/notificationNavigation.ts`가 맡는다.
 *
 * **계약(`marketNotify.ts`와 같다):** 어느 함수도 throw하지 않는다. 실패는
 * `log.error`만 남긴다. 원장 트랜잭션이 **커밋된 뒤에** 부른다 — 알림이 실패해도
 * 시간 이동은 이미 확정됐고, 알림이 이동을 되돌리거나 막아서는 안 된다.
 * 알림은 30일 뒤 만료된다. 알림 받기 설정·이메일은 1단계에 없다(항상 보낸다).
 *
 * 테스트가 DB 없이 받는 사람·종류를 확인할 수 있게 마지막 인자로 의존성을
 * 바꿔 끼울 수 있다(`src/lib/funding/notify.ts`와 같은 방식).
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export interface TimebankNotifyDeps {
  createBulkNotifications: typeof createBulkNotifications
  log: { error: (message: string, meta?: Record<string, unknown>) => void }
  now: () => number
}

const realDeps: TimebankNotifyDeps = {
  createBulkNotifications,
  log: createLogger('timebankNotify'),
  now: () => Date.now(),
}

function resolveDeps(overrides?: Partial<TimebankNotifyDeps>): TimebankNotifyDeps {
  return overrides ? { ...realDeps, ...overrides } : realDeps
}

type BulkInput = Parameters<typeof createBulkNotifications>[0]

/**
 * 한 번 보내고, 무엇이 던져지든 삼킨다. 받는 사람이 없으면 아무것도 하지 않는다.
 * 받는 사람 목록은 중복을 걷고 조합 계좌·빈 값을 뺀다.
 */
async function send(
  d: TimebankNotifyDeps,
  input: Omit<BulkInput, 'expires_at'>,
  context: Record<string, unknown>
): Promise<void> {
  try {
    const userIds = uniqueMembers(input.user_ids)
    if (userIds.length === 0) return
    await d.createBulkNotifications({
      ...input,
      user_ids: userIds,
      expires_at: new Date(d.now() + THIRTY_DAYS_MS).toISOString(),
    })
  } catch (e) {
    d.log.error('타임뱅크 알림 발송 실패', {
      type: input.type,
      ...context,
      error: (e as Error)?.message,
    })
  }
}

function uniqueMembers(ids: ReadonlyArray<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0 && id !== COOP_ACCOUNT) out.add(id)
  }
  return [...out]
}

/** 기록자(`created_by`)의 이름. 원장 행이 들고 있는 표시명 스냅숏을 쓴다. */
function recorderName(row: TransferRow): string {
  const name = row.created_by === row.from_account ? row.from_name : row.to_name
  return name?.trim() || '조합원'
}

/**
 * 결정(확인·거절·취소) 알림을 받을 사람. 부수효과가 없어 테스트로 고정한다.
 *
 * - 행위자가 한쪽 당사자면 **다른 당사자 1명**이다. 상대가 확인·거절하면
 *   기록자에게, 기록자가 취소하면 상대에게 간다.
 * - 행위자가 당사자가 아니면(관리자 취소, 계획 Task 9) 두 당사자 모두에게 간다
 *   — 둘 다 자기 기록이 사라진 이유를 알아야 한다.
 * - 조합 계좌(`coop`)와 빈 칸은 받는 사람이 아니다.
 */
export function pickRecipientsForDecision(row: TransferRow, actorId: string): string[] {
  const parties = uniqueMembers([row.created_by, row.counterparty_id])
  if (parties.includes(actorId)) return parties.filter(id => id !== actorId)
  return parties
}

/** 기록이 생겼다 → 확인할 상대(`counterparty_id`)에게. */
export async function notifyTransferPending(
  row: TransferRow,
  overrides?: Partial<TimebankNotifyDeps>
): Promise<void> {
  const d = resolveDeps(overrides)
  try {
    if (!row?.counterparty_id) return
    await send(
      d,
      {
        user_ids: [row.counterparty_id],
        type: 'timebank_pending',
        title: '타임 기록을 확인해 주세요',
        message: `${recorderName(row)}님이 ${formatMinutes(row.minutes)} 기록을 남겼습니다. 확인하거나 거절해 주세요.`,
        data: { transfer_id: row.id, kind: row.kind, minutes: row.minutes },
        related_user_id: row.created_by ?? undefined,
      },
      { transferId: row.id }
    )
  } catch (e) {
    d.log.error('타임뱅크 기록 알림 준비 실패', { error: (e as Error)?.message })
  }
}

const DECISION_COPY = {
  confirmed: { type: 'timebank_confirmed', title: '타임 기록이 확인됐습니다', verb: '확인' },
  rejected: { type: 'timebank_rejected', title: '타임 기록이 거절됐습니다', verb: '거절' },
  canceled: { type: 'timebank_canceled', title: '타임 기록이 취소됐습니다', verb: '취소' },
} as const

/**
 * 기록이 확인·거절·취소됐다 → 다른 당사자에게(`pickRecipientsForDecision`).
 * `reason`(거절·취소 사유, 선택)이 있으면 문구 끝에 `사유: …`로 싣는다.
 */
export async function notifyTransferDecided(
  row: TransferRow,
  actorId: string,
  overrides?: Partial<TimebankNotifyDeps>,
  reason?: string | null
): Promise<void> {
  const d = resolveDeps(overrides)
  try {
    if (!row) return
    const copy = DECISION_COPY[row.status as keyof typeof DECISION_COPY]
    if (!copy) return
    await send(
      d,
      {
        user_ids: pickRecipientsForDecision(row, actorId),
        type: copy.type,
        title: copy.title,
        message: `${formatMinutes(row.minutes)} 기록이 ${copy.verb}됐습니다.${
          reason?.trim() ? ` 사유: ${reason.trim()}` : ''
        }`,
        data: { transfer_id: row.id, kind: row.kind, minutes: row.minutes, status: row.status },
        related_user_id: actorId,
      },
      { transferId: row.id, status: row.status }
    )
  } catch (e) {
    d.log.error('타임뱅크 결정 알림 준비 실패', { error: (e as Error)?.message })
  }
}

/**
 * 관리자 취소(분쟁 정리, 계획 Task 9)를 알릴 사람. **행위자를 뺀 모든 당사자**다.
 *
 * `pickRecipientsForDecision`은 기록자·상대(`created_by`·`counterparty_id`)만 본다.
 * 조정 pending은 상대가 null이고 기록자가 관리자라 그것만으로는 **대상 회원이
 * 빠진다**. 그래서 원장 양쪽 계좌(`from`·`to`)도 함께 본다 — 회원 간 기록이면
 * 결과가 같고, 조정이면 대상 회원과 조정을 만든 관리자(취소한 사람이 아니면)다.
 */
export function pickRecipientsForAdminCancel(row: TransferRow, actorId: string): string[] {
  return uniqueMembers([
    row.created_by,
    row.counterparty_id,
    row.from_account,
    row.to_account,
  ]).filter(id => id !== actorId)
}

/** 관리자가 pending을 취소했다 → 행위자를 뺀 모든 당사자에게(사유 포함). */
export async function notifyTransferCanceledByAdmin(
  row: TransferRow,
  input: { adminId: string; memo: string },
  overrides?: Partial<TimebankNotifyDeps>
): Promise<void> {
  const d = resolveDeps(overrides)
  try {
    if (!row) return
    await send(
      d,
      {
        user_ids: pickRecipientsForAdminCancel(row, input.adminId),
        type: 'timebank_canceled',
        title: '관리자가 타임 기록을 취소했습니다',
        message: `${formatMinutes(row.minutes)} 기록을 관리자가 취소했습니다. 사유: ${input.memo}`,
        data: {
          transfer_id: row.id,
          kind: row.kind,
          minutes: row.minutes,
          status: row.status,
          by_admin: true,
        },
        related_user_id: input.adminId,
      },
      { transferId: row.id, status: row.status, byAdmin: true }
    )
  } catch (e) {
    d.log.error('타임뱅크 관리자 취소 알림 준비 실패', { error: (e as Error)?.message })
  }
}

const CREDIT_LABEL: Partial<Record<TimebankKind, string>> = {
  signup_grant: '가입 크레딧',
  coop_task: '조합 업무 크레딧',
  adjustment: '관리자 조정',
  redeem_refund: '교환 환불',
}

/** 조합 계좌에서 시간이 들어왔다(가입·조합 업무·조정·환불) → 받은 회원에게. */
export async function notifyCredited(
  input: { memberId: string; kind: TimebankKind; minutes: number },
  overrides?: Partial<TimebankNotifyDeps>
): Promise<void> {
  const d = resolveDeps(overrides)
  try {
    const label = CREDIT_LABEL[input.kind] ?? '타임 적립'
    await send(
      d,
      {
        user_ids: [input.memberId],
        type: 'timebank_credited',
        title: '타임이 적립됐습니다',
        message: `${label}: ${formatMinutes(input.minutes)}이 내 타임에 들어왔습니다.`,
        data: { kind: input.kind, minutes: input.minutes },
      },
      { kind: input.kind }
    )
  } catch (e) {
    d.log.error('타임뱅크 적립 알림 준비 실패', { error: (e as Error)?.message })
  }
}

export type NotifyTimebankCommentInput = {
  listingId: string
  listingTitle: string
  authorId: string
  commentId: string
  actorId: string
  /** 이 댓글을 쓰기 **전에** 댓글을 남긴 사람들(삭제분 제외). */
  priorCommenterIds: string[]
}

/**
 * 타임뱅크 글 댓글. 받는 사람 규칙은 장터와 같다(`pickMarketCommentRecipients`) —
 * 남이 쓰면 글쓴이에게만, 글쓴이가 쓰면 앞서 댓글 단 사람 전부에게.
 */
export async function notifyTimebankComment(
  input: NotifyTimebankCommentInput,
  overrides?: Partial<TimebankNotifyDeps>
): Promise<void> {
  const d = resolveDeps(overrides)
  try {
    const recipients = pickMarketCommentRecipients({
      sellerId: input.authorId,
      actorId: input.actorId,
      priorCommenterIds: input.priorCommenterIds,
    })
    const fromAuthor = input.actorId === input.authorId
    await send(
      d,
      {
        user_ids: recipients,
        type: 'timebank_comment',
        title: fromAuthor ? '글쓴이가 답글을 남겼습니다' : '타임뱅크 글에 댓글이 달렸습니다',
        message: `${input.listingTitle}에 새 댓글이 달렸습니다.`,
        data: { listing_id: input.listingId, comment_id: input.commentId },
        related_post_id: input.listingId,
        related_user_id: input.actorId,
      },
      { listingId: input.listingId, commentId: input.commentId }
    )
  } catch (e) {
    d.log.error('타임뱅크 댓글 알림 준비 실패', { error: (e as Error)?.message })
  }
}

/** 조합 업무 글에 자원했다 → 글을 쓴 관리자에게. 스스로 자원하면 보내지 않는다. */
export async function notifyVolunteer(
  input: { listingId: string; listingTitle: string; authorId: string; volunteerId: string },
  overrides?: Partial<TimebankNotifyDeps>
): Promise<void> {
  const d = resolveDeps(overrides)
  try {
    if (input.volunteerId === input.authorId) return
    await send(
      d,
      {
        user_ids: [input.authorId],
        type: 'timebank_volunteer',
        title: '조합 업무에 자원한 조합원이 있습니다',
        message: `${input.listingTitle}에 새 자원자가 있습니다.`,
        data: { listing_id: input.listingId },
        related_post_id: input.listingId,
        related_user_id: input.volunteerId,
      },
      { listingId: input.listingId }
    )
  } catch (e) {
    d.log.error('타임뱅크 자원 알림 준비 실패', { error: (e as Error)?.message })
  }
}

/**
 * 음수 잔액으로 탈퇴했다(조합이 떠안음, 스펙 §9.3 4단계) → 이사 전원에게.
 * `minutes`는 정산 전 잔액(음수)이다. 개인을 특정하는 이름은 알림에 싣지 않는다
 * — 이사회 보고 탭에서 본다.
 */
export async function notifyNegativeWithdrawal(
  input: { directorIds: string[]; minutes: number },
  overrides?: Partial<TimebankNotifyDeps>
): Promise<void> {
  const d = resolveDeps(overrides)
  try {
    await send(
      d,
      {
        user_ids: input.directorIds,
        type: 'timebank_withdrawal_negative',
        title: '타임뱅크 음수 잔액 탈퇴가 있습니다',
        message: `탈퇴한 조합원의 잔액 ${formatMinutes(input.minutes)}을 조합이 떠안았습니다. 이사회 보고에서 확인해 주세요.`,
        data: { minutes: input.minutes },
      },
      { minutes: input.minutes }
    )
  } catch (e) {
    d.log.error('타임뱅크 탈퇴 알림 준비 실패', { error: (e as Error)?.message })
  }
}
