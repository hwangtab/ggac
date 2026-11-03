/**
 * 탈퇴 확정 트랜잭션 안의 타임뱅크 단계 (스펙 §9.3, 계획 Task 10).
 *
 * `withdrawMember`(`withdrawal.ts`)가 **자기 트랜잭션 안에서** 부른다. 라우트가
 * 부르지 않는 이유: 탈퇴가 뒤에서 실패하면(자체 단언·외래 쓰기 오류) 이 단계도
 * 함께 롤백되어야 한다. 그래서 여기서는 트랜잭션을 열지 않고 재시도도 하지
 * 않는다 — 받은 `tx`만 쓴다. 기능 스위치는 보지 않는다(§7.2: 탈퇴는 모든 스위치를
 * 무시한다).
 *
 * `timebankLedger.ts`가 아니라 별도 파일인 이유: 키 기록(`recordWithdrawnKeys`)이
 * `timebankProfiles.ts`에 있고, 그 파일이 이미 `timebankLedger.ts`를 임포트한다.
 * 원장 파일에 두면 두 모듈이 서로를 임포트하는 순환이 생긴다.
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — 권한을 모른다. 임포트는 상대경로 + `.ts`.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm'

import { WITHDRAWN_DISPLAY_NAME } from '../../constants/memberProfile.ts'
import { COOP_ACCOUNT } from '../../constants/timebank.ts'
import { rejoinKeysFor, rejoinSecretFromEnv } from '../../lib/timebank/rejoinKey.ts'
import {
  timebankListings,
  timebankProfiles,
  timebankTaskVolunteers,
  timebankTransfers,
} from '../schema/index.ts'

import { balanceOf, type Tx } from './timebankLedger.ts'
import { recordWithdrawnKeys } from './timebankProfiles.ts'

const t = timebankTransfers

/** 정산 행의 memo(정산은 memo 필수 — 스키마 주석). */
export const WITHDRAWAL_SETTLEMENT_MEMO = '탈퇴 정산'

/** 탈퇴로 시스템이 취소한 pending의 memo 꼬리. */
export const WITHDRAWAL_CANCEL_NOTE = '탈퇴로 취소'

/** 탈퇴 직전의 신원. 첫 묘비 UPDATE **전에** 읽은 값이어야 한다(§9.3 순서 주의). */
export type TimebankWithdrawalPrior = { email: string | null; phone: string | null }

export type TimebankWithdrawalResult = {
  /** 정산 전 잔액(분). */
  balanceBefore: number
  /** 정산 전 잔액이 음수였으면 그 절댓값(조합이 떠안은 분). 아니면 null. */
  negativeMinutes: number | null
}

/**
 * 스펙 §9.3의 일곱 단계를 순서대로 한다. 끝에서 스스로 확인하고(잔액 0·pending 0·
 * 프로필 0·이름 묘비), 어기면 던져서 탈퇴 전체를 롤백시킨다.
 *
 * `BETTER_AUTH_SECRET`이 없으면 **던진다**(계획 Task 10-4) — 키 기록을 조용히
 * 건너뛰면 음수 잔액을 탈퇴·재가입으로 세탁할 수 있다(§15 C1). 키가 필요 없는
 * 회원(프로필도 잔액도 없음)은 비밀값을 읽지 않는다.
 */
export async function withdrawTimebankTx(
  tx: Tx,
  memberId: string,
  prior: TimebankWithdrawalPrior,
  now: Date
): Promise<TimebankWithdrawalResult> {
  const [profile] = await tx
    .select({ memberId: timebankProfiles.memberId })
    .from(timebankProfiles)
    .where(eq(timebankProfiles.memberId, memberId))
    .limit(1)

  // 1. 그 회원이 당사자인 pending 전부 canceled — 보낸 쪽·받는 쪽·확인할 사람
  //    어느 쪽이든. 관리자가 기록한 조정(coop ↔ 회원)도 from/to로 잡힌다.
  //    **시스템 취소다** — 결정자는 비운다(null). 탈퇴 회원을 결정자로 적으면 관리자
  //    조정을 그 회원이 "취소했다"고 기록하게 된다. 사유는 memo 끝에 붙인다(원 memo가
  //    있으면 `원 memo / 탈퇴로 취소`, `adminCancelPending`과 같은 꼴). pending 행이라
  //    `timebank_transfers_final_immutable`(OLD가 pending이 아닐 때만)에 걸리지 않고,
  //    `core_immutable`은 status·decided_*·memo를 잠그지 않는다.
  await tx
    .update(t)
    .set({
      status: 'canceled',
      decidedBy: null,
      decidedAt: now,
      memo: sql`case when ${t.memo} is null or ${t.memo} = '' then ${WITHDRAWAL_CANCEL_NOTE} else ${t.memo} || ' / ' || ${WITHDRAWAL_CANCEL_NOTE} end`,
    })
    .where(
      and(
        eq(t.status, 'pending'),
        or(eq(t.fromAccount, memberId), eq(t.toAccount, memberId), eq(t.counterpartyId, memberId))
      )
    )

  // 2. (1-B 이음매) 전달 전 교환소 주문 취소 + `redeem_refund`, 공연 전 교환권 예매
  //    취소 + `redeem_refund`(24시간 기한 예외 — 이용규칙 제10조 ⑤). 1-A에는 교환권·
  //    교환소 표가 없어 할 일이 없다. **정산(3) 앞**이어야 한다 — 환불이 잔액에
  //    들어간 뒤에 정산해야 0이 된다.

  // 3. 잔액 SUM → 0이 아니면 `withdrawal_settlement`로 0을 만든다.
  //    양수는 회원 → coop(회수), 음수는 coop → 회원(조합이 떠안음).
  const balanceBefore = await balanceOf(memberId, tx)
  if (balanceBefore !== 0) {
    const outward = balanceBefore > 0
    await tx.insert(t).values({
      fromAccount: outward ? memberId : COOP_ACCOUNT,
      toAccount: outward ? COOP_ACCOUNT : memberId,
      minutes: Math.abs(balanceBefore),
      kind: 'withdrawal_settlement',
      status: 'confirmed',
      createdBy: null,
      decidedBy: null,
      decidedAt: now,
      memo: WITHDRAWAL_SETTLEMENT_MEMO,
      fromName: outward ? WITHDRAWN_DISPLAY_NAME : null,
      toName: outward ? null : WITHDRAWN_DISPLAY_NAME,
      createdAt: now,
    })
  }

  // 4. 음수였다면 이사회 보고 대상. 보고 자체는 이 정산 행(coop → 회원)이다 —
  //    `monthlyOversight`의 `negative_withdrawals`가 읽는다. 이사 알림은 커밋 뒤
  //    호출부가 이 반환값으로 보낸다(트랜잭션 안에서 알림을 보내지 않는다).
  const negativeMinutes = balanceBefore < 0 ? -balanceBefore : null

  // 5. 재가입 키(미리 읽은 이메일·전화, 정산 **전** 잔액). 참여자였던 회원만 —
  //    프로필이 있었거나 잔액이 있었던 경우. 같은 키는 ON CONFLICT DO UPDATE.
  if (profile || balanceBefore !== 0) {
    const keys = rejoinKeysFor(prior, rejoinSecretFromEnv())
    await recordWithdrawnKeys(tx, keys, balanceBefore, now)
  }

  // 6. 프로필 DELETE(member_profiles는 묘비로 남아 cascade가 일어나지 않는다),
  //    글 soft delete, 조합 업무 자원 철회.
  await tx.delete(timebankProfiles).where(eq(timebankProfiles.memberId, memberId))
  await tx
    .update(timebankListings)
    .set({ isDeleted: true })
    .where(and(eq(timebankListings.authorId, memberId), eq(timebankListings.isDeleted, false)))
  await tx
    .update(timebankTaskVolunteers)
    .set({ withdrawnAt: now })
    .where(
      and(eq(timebankTaskVolunteers.memberId, memberId), isNull(timebankTaskVolunteers.withdrawnAt))
    )

  // 7. 원장 이름을 묘비로. 트리거(`timebank_transfers_final_immutable`)는 확정 뒤
  //    행에서 이름 칸을 **묘비 값으로만** 바꾸게 허용한다 — 다른 칸은 건드리지 않는다.
  await tx
    .update(t)
    .set({ fromName: WITHDRAWN_DISPLAY_NAME })
    .where(and(eq(t.fromAccount, memberId), sql`${t.fromName} IS NOT ${WITHDRAWN_DISPLAY_NAME}`))
  await tx
    .update(t)
    .set({ toName: WITHDRAWN_DISPLAY_NAME })
    .where(and(eq(t.toAccount, memberId), sql`${t.toName} IS NOT ${WITHDRAWN_DISPLAY_NAME}`))

  // 자체 단언 — 어기면 던져서 탈퇴 전체를 롤백한다(`withdrawMember`의 단언과 같은 발상).
  const after = await balanceOf(memberId, tx)
  const [pending] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(t)
    .where(
      and(
        eq(t.status, 'pending'),
        or(eq(t.fromAccount, memberId), eq(t.toAccount, memberId), eq(t.counterpartyId, memberId))
      )
    )
  const [profiles] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(timebankProfiles)
    .where(eq(timebankProfiles.memberId, memberId))
  const [names] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(t)
    .where(
      or(
        and(eq(t.fromAccount, memberId), sql`${t.fromName} IS NOT ${WITHDRAWN_DISPLAY_NAME}`),
        and(eq(t.toAccount, memberId), sql`${t.toName} IS NOT ${WITHDRAWN_DISPLAY_NAME}`)
      )
    )
  const problems = [
    after !== 0 && `잔액 ${after}`,
    Number(pending?.n ?? 0) > 0 && `pending ${pending.n}`,
    Number(profiles?.n ?? 0) > 0 && '프로필',
    Number(names?.n ?? 0) > 0 && `이름 ${names.n}`,
  ].filter(Boolean)
  if (problems.length > 0) {
    throw new Error(
      `탈퇴 처리 후에도 타임뱅크 흔적이 남았다(${problems.join(', ')}) — 전체를 롤백한다`
    )
  }

  return { balanceBefore, negativeMinutes }
}
