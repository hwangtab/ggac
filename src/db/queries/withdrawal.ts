/**
 * 회원 탈퇴 — 신청·취소·확정.
 *
 * 설계는 `docs/superpowers/specs/2026-09-01-member-withdrawal-design.md`에 있다.
 *
 * 이 파일은 **권한을 모른다**(저장소 규칙). 누가 부를 수 있는지는 라우트가
 * 판정하고, 여기서는 "그 상태에서 그 전이가 가능한가"만 본다.
 */
import { and, eq } from 'drizzle-orm'

import { db } from '../client.ts'
import { memberProfiles } from '../schema/index.ts'

/**
 * 탈퇴를 신청한다. 승인 상태인 조합원만 신청할 수 있다.
 *
 * **조건부 UPDATE + rowsAffected 판정이다.** 읽고-판단하고-쓰면 관리자와 회원이
 * 동시에 상태를 바꿀 때 어긋난다 — 같은 저장소의 승인/거부가 그 방식이라
 * 관리자 둘이 동시에 누르면 승인 알림과 거부 알림이 둘 다 가는 경합이 실재한다.
 */
export async function requestWithdrawal(userId: string): Promise<boolean> {
  const result = await db
    .update(memberProfiles)
    .set({ registrationStatus: 'withdrawal_requested' })
    .where(and(eq(memberProfiles.id, userId), eq(memberProfiles.registrationStatus, 'approved')))
  return (result.rowsAffected ?? 0) > 0
}

/** 신청을 취소해 승인 상태로 되돌린다. 신청 상태에서만 된다. */
export async function cancelWithdrawal(userId: string): Promise<boolean> {
  const result = await db
    .update(memberProfiles)
    .set({ registrationStatus: 'approved' })
    .where(
      and(
        eq(memberProfiles.id, userId),
        eq(memberProfiles.registrationStatus, 'withdrawal_requested')
      )
    )
  return (result.rowsAffected ?? 0) > 0
}
