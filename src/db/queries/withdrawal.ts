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
 * **상태값을 바꾸지 않는다.** `withdrawal_requested_at`만 채운다 —
 * `registration_status`는 신청 중에도 `'approved'` 그대로다. 상태를 바꾸면
 * `isApprovedActive`를 비롯해 이 값을 직접 비교하는 저장소 전역(실측 36곳)이
 * 신청자를 승인 조합원 판정에서 배제해, 취소 API조차 부를 수 없게 되는
 * 결함이 있었다(`0011_add_withdrawal_requested_at.sql` 참조).
 *
 * **조건부 UPDATE + rowsAffected 판정이다.** 읽고-판단하고-쓰면 관리자와 회원이
 * 동시에 상태를 바꿀 때 어긋난다 — 같은 저장소의 승인/거부가 그 방식이라
 * 관리자 둘이 동시에 누르면 승인 알림과 거부 알림이 둘 다 가는 경합이 실재한다.
 */
export async function requestWithdrawal(userId: string): Promise<boolean> {
  const result = await db
    .update(memberProfiles)
    .set({ withdrawalRequestedAt: new Date() })
    .where(
      and(
        eq(memberProfiles.id, userId),
        eq(memberProfiles.registrationStatus, 'approved'),
        sql`${memberProfiles.withdrawalRequestedAt} IS NULL`
      )
    )
  return (result.rowsAffected ?? 0) > 0
}

/** 신청을 취소한다. 신청 중(타임스탬프가 있는 상태)에서만 된다. */
export async function cancelWithdrawal(userId: string): Promise<boolean> {
  const result = await db
    .update(memberProfiles)
    .set({ withdrawalRequestedAt: null })
    .where(
      and(eq(memberProfiles.id, userId), sql`${memberProfiles.withdrawalRequestedAt} IS NOT NULL`)
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
 * 탈퇴 확정 때 반드시 지워야 할 개인정보 컬럼과 그 목표값(전부 null)을
 * 한곳에 묶는다. 아래 `.set()`과 끝의 자체 단언이 **이 객체 하나**를
 * 함께 쓴다 — 컬럼을 추가하면서 한쪽만 고치는 사고를 구조적으로 막는다.
 *
 * **정본이다.** `scripts/turso/check-invariants.mjs`의
 * `withdrawn_rows_have_no_personal_data`가 야간에 같은 성질(탈퇴 행에
 * 개인정보가 없어야 한다)을 앱 밖 우회 쓰기까지 잡으려고 별도로 검사한다.
 * 그 파일은 `.mjs`라 이 `.ts` 객체를 임포트하지 못해(플래그 없이 CI에서
 * 도는 GitHub Actions 백업 워크플로가 깨진다) 컬럼 목록을 문자로 다시
 * 적는다 — 두 목록이 같은지는 `scripts/testing/piiNullFieldsParity.test.mjs`가
 * 못박는다. 여기 컬럼을 추가·삭제하면 그 목록도 고쳐라.
 */
export const PII_NULL_FIELDS = {
  realName: null,
  phoneNumber: null,
  birthDate: null,
  bankName: null,
  accountNumber: null,
  accountHolder: null,
  monthlyFee: null,
} as const

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
        // 신청 타임스탬프는 확정되면 더 이상 의미가 없다 — 정리해 둔다.
        withdrawalRequestedAt: null,
        displayName: WITHDRAWN_DISPLAY_NAME,
        email: withdrawnEmailFor(userId),
        ...PII_NULL_FIELDS,
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
          eq(memberProfiles.registrationStatus, 'approved'),
          sql`${memberProfiles.withdrawalRequestedAt} IS NOT NULL`,
          // 마지막 관리자를 내보내면 조합이 잠긴다.
          //
          // 신청이 이제 상태값이 아니라 타임스탬프라, 신청자 본인은 이
          // 시점에도 registration_status가 여전히 'approved'다 — 그래서
          // 아래 count는 **자기 자신을 명시적으로 빼야** "본인 말고 남는
          // 승인 관리자 수"가 된다(`id != userId`). 빼지 않으면 본인이 항상
          // 집계에 잡혀 count가 실제보다 1 많아지고, "본인 포함 관리자
          // 1명"인 흔한 경우(본인이 유일한 관리자)조차 count > 0이 참이
          // 되어 마지막 관리자 차단이 무력화된다 — 그 값이 항상 참이 되는
          // 결함이 바로 이번에 고치는 대상이다.
          //
          // `id != userId`로 자신을 뺀 뒤에는 "본인 제외 승인 관리자가
          // 1명 이상"이 정확히 "탈퇴해도 관리자가 남는다"는 뜻이므로
          // count > 0이 맞다(> 1로 쓰면 본인 말고 2명이 더 있어야 통과해,
          // 관리자가 정상적으로 1명 남는 탈퇴까지 막는다).
          sql`((SELECT count(*) FROM ${memberProfiles} WHERE is_admin = 1 AND registration_status = 'approved' AND id != ${userId}) > 0
              OR (SELECT is_admin FROM ${memberProfiles} WHERE id = ${userId}) = 0)`
        )
      )

    if ((claimed.rowsAffected ?? 0) === 0) {
      // 신청 중이 아니거나 마지막 관리자다. 둘을 구분해 호출부가 다른 메시지를
      // 줄 수 있게 한다.
      const [row] = await tx
        .select({
          status: memberProfiles.registrationStatus,
          requestedAt: memberProfiles.withdrawalRequestedAt,
          isAdmin: memberProfiles.isAdmin,
        })
        .from(memberProfiles)
        .where(eq(memberProfiles.id, userId))
      const wasRequested = row?.status === 'approved' && row.requestedAt != null
      const reason = wasRequested && row?.isAdmin ? 'last_admin' : 'not_requested'
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
    // PII_NULL_FIELDS의 키를 그대로 도는 이유: 위 `.set()`이 지우기로 한
    // 컬럼과 여기서 확인하는 컬럼이 같은 객체에서 나와야, 나중에 컬럼 하나를
    // 추가하면서 한쪽만 고치는 사고가 안 생긴다.
    const piiColumns = Object.keys(PII_NULL_FIELDS) as Array<keyof typeof PII_NULL_FIELDS>
    const [leftover] = await tx
      .select(
        Object.fromEntries(piiColumns.map(key => [key, memberProfiles[key]])) as Record<
          keyof typeof PII_NULL_FIELDS,
          (typeof memberProfiles)[keyof typeof PII_NULL_FIELDS]
        >
      )
      .from(memberProfiles)
      .where(eq(memberProfiles.id, userId))
    const leaked = piiColumns.filter(
      key => (leftover as Record<string, unknown> | undefined)?.[key] !== null
    )
    if (leaked.length > 0) {
      throw new Error(`탈퇴 처리 후에도 개인정보가 남았다(${leaked.join(', ')}) — 전체를 롤백한다`)
    }

    return { ok: true, revokedBillingKeys }
  })
}
