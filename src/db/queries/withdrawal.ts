/**
 * 회원 탈퇴 — 신청·취소·확정.
 *
 * 설계는 `docs/superpowers/specs/2026-09-01-member-withdrawal-design.md`에 있다.
 *
 * 이 파일은 **권한을 모른다**(저장소 규칙). 누가 부를 수 있는지는 라우트가
 * 판정하고, 여기서는 "그 상태에서 그 전이가 가능한가"만 본다.
 */
import { and, eq, sql } from 'drizzle-orm'

import { WITHDRAWN_DISPLAY_NAME, withdrawnEmailFor } from '../../constants/memberProfile.ts'
import { db } from '../client.ts'
import {
  account,
  billingKeys,
  dailyActivityStats,
  memberProfiles,
  notifications,
  session,
  user,
  userActivities,
  userSessions,
  userSettings,
} from '../schema/index.ts'

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

/**
 * 확정의 결과. 성공하면 **해지해야 할 토스 빌링키**를 함께 돌려준다 —
 * 트랜잭션이 행을 지우고 나면 다시 읽을 수 없기 때문이다(Task 7이 커밋 뒤에
 * `deleteBillingKey`를 부른다).
 */
export type WithdrawOutcome =
  | { ok: true; revokedBillingKeys: string[] }
  | { ok: false; reason: 'not_requested' | 'last_admin' }

/**
 * 탈퇴를 확정한다. **되돌릴 수 없다.**
 *
 * 전부 한 트랜잭션 안에서 한다. 중간에 실패하면 전부 롤백되어 "이름만 지워지고
 * 로그는 남은" 반쪽 상태가 생기지 않는다 — 마이그레이션 다섯 개에 트랜잭션을
 * 씌운 것과 같은 이유다(2026-09-01).
 *
 * 22개 표를 네 갈래로 나눈다. ① 신원·로그인 수단은 지우거나 묘비로 덮고,
 * ② 콘텐츠·조합 기록(글·댓글·이사회)은 **한 건도 건드리지 않는다**(작성자
 * 컬럼이 NOT NULL이라 참조가 묘비를 가리킨 채 남는다), ③ 로그는 지우고,
 * ④ 결제·회비 원장은 회계 증빙이라 남기되 결제 수단만 지운다.
 *
 * 끝에서 **스스로 확인한다**. 개인정보가 하나라도 남아 있으면 던져서 롤백시킨다.
 * 마이그레이션 `0002`~`0005`가 쓰는 자체 단언과 같은 발상이다.
 *
 * **토스 빌링키 해지는 여기서 하지 않는다.** 외부 호출을 트랜잭션 안에 넣으면
 * 쓰기 락을 잡은 채 네트워크를 기다린다. 호출부가 커밋 뒤에 부른다.
 */
export async function withdrawMember(userId: string): Promise<WithdrawOutcome> {
  return db.transaction(async tx => {
    // 상태 전이 + 마지막 관리자 차단을 **한 UPDATE 안에서** 원자적으로 한다.
    // 읽고-판단하고-쓰면 관리자가 둘 동시에 눌렀을 때 둘 다 통과한다.
    const claimed = await tx
      .update(memberProfiles)
      .set({
        registrationStatus: 'withdrawn',
        withdrawnAt: new Date(),
        displayName: WITHDRAWN_DISPLAY_NAME,
        email: withdrawnEmailFor(userId),
        realName: null,
        phoneNumber: null,
        birthDate: null,
        bankName: null,
        accountNumber: null,
        accountHolder: null,
        monthlyFee: null,
        lastLoginAt: null,
        suspensionReason: null,
        suspensionUntil: null,
        artistId: null,
        directorTitle: null,
        // NOT NULL default 'owner' — NULL로 둘 수 없다(실측).
        artistRole: 'owner',
        verificationStatus: { email: false, phone: false, identity: false },
        isActive: false,
        isAdmin: false,
        isDirector: false,
        isAuditor: false,
        isArtist: false,
        isMember: false,
        isSuspended: false,
      })
      .where(
        and(
          eq(memberProfiles.id, userId),
          eq(memberProfiles.registrationStatus, 'withdrawal_requested'),
          // 마지막 관리자를 내보내면 조합이 잠긴다.
          sql`((SELECT count(*) FROM ${memberProfiles} WHERE is_admin = 1 AND registration_status = 'approved') > 1
              OR (SELECT is_admin FROM ${memberProfiles} WHERE id = ${userId}) = 0)`
        )
      )

    if ((claimed.rowsAffected ?? 0) === 0) {
      // 신청 상태가 아니거나 마지막 관리자다. 둘을 구분해 호출부가 다른 메시지를
      // 줄 수 있게 한다.
      const [row] = await tx
        .select({ status: memberProfiles.registrationStatus, isAdmin: memberProfiles.isAdmin })
        .from(memberProfiles)
        .where(eq(memberProfiles.id, userId))
      const reason =
        row?.status === 'withdrawal_requested' && row.isAdmin ? 'last_admin' : 'not_requested'
      return { ok: false, reason }
    }

    // ③ 로그 — 지운다. `user_activities`에 IP·User-Agent가 있다.
    await tx.delete(userActivities).where(eq(userActivities.userId, userId))
    await tx.delete(userSessions).where(eq(userSessions.userId, userId))
    await tx.delete(dailyActivityStats).where(eq(dailyActivityStats.userId, userId))
    await tx.delete(notifications).where(eq(notifications.userId, userId))
    await tx.delete(userSettings).where(eq(userSettings.userId, userId))
    // 남의 알림이 이 사람을 가리키는 참조를 끊는다(nullable 확인됨).
    await tx
      .update(notifications)
      .set({ relatedUserId: null })
      .where(eq(notifications.relatedUserId, userId))

    // ④ 결제 수단 — 지운다. 결제·회비 기록은 남긴다(회계 증빙).
    // 토스 해지에 쓸 키를 **지우기 전에** 읽어 둔다. 커밋 뒤 라우트가 부른다.
    const revokedBillingKeys = (
      await tx
        .select({ key: billingKeys.billingKey })
        .from(billingKeys)
        .where(eq(billingKeys.userId, userId))
    ).map(r => r.key)
    await tx.delete(billingKeys).where(eq(billingKeys.userId, userId))

    // ① 로그인 수단 — 지운다. Better Auth의 user 행은 묘비로 덮는다.
    await tx.delete(account).where(eq(account.userId, userId))
    await tx.delete(session).where(eq(session.userId, userId))
    await tx
      .update(user)
      .set({
        email: withdrawnEmailFor(userId),
        name: WITHDRAWN_DISPLAY_NAME,
        image: null,
        emailVerified: false,
      })
      .where(eq(user.id, userId))

    // 자체 단언 — 개인정보가 남았으면 던져서 전부 롤백시킨다. 장식이 아니다.
    const [leftover] = await tx
      .select({
        realName: memberProfiles.realName,
        phoneNumber: memberProfiles.phoneNumber,
        birthDate: memberProfiles.birthDate,
        accountNumber: memberProfiles.accountNumber,
      })
      .from(memberProfiles)
      .where(eq(memberProfiles.id, userId))
    if (
      leftover?.realName !== null ||
      leftover?.phoneNumber !== null ||
      leftover?.birthDate !== null ||
      leftover?.accountNumber !== null
    ) {
      throw new Error('탈퇴 처리 후에도 개인정보가 남았다 — 전체를 롤백한다')
    }

    return { ok: true, revokedBillingKeys }
  })
}
