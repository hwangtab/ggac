/**
 * 권한을 내리는 액션이 관리자 화면을 잠그는가 — **판정에 필요한 것을 DB에서
 * 모아 온다.**
 *
 * 규칙 자체는 `@/lib/members/adminLockoutGuard`(순수)에 있다. 여기서는 그
 * 규칙이 먹을 모양으로 "지금 남아 있는 관리자 수"를 세어 넘길 뿐이다
 * (`fundingWithdrawal.ts`가 `withdrawalGuard`에 하는 것과 같은 방식).
 *
 * 관리자가 대상일 때만 센다 — 대상이 관리자가 아니면 내려도 관리자 수가
 * 줄지 않으므로 쿼리를 쏠 이유가 없다.
 *
 * **읽기만 한다. 누가 부를 수 있는지는 부르는 자리가 정한다.**
 */

import { countActiveAdminsExcluding } from '@/db/queries/profiles'
import {
  adminLockoutVerdict,
  isAdminLockoutAction,
  type AdminLockoutVerdict,
} from '@/lib/members/adminLockoutGuard'
import { isApprovedActiveAdmin, type ProfileLike } from '@/lib/server/authz'

const PASS: AdminLockoutVerdict = { blocked: false }

/** 한 사람에게 한 액션 — `/api/admin/member-action`. */
export async function adminLockoutVerdictFor(params: {
  action: string
  actorId: string
  targetId: string
  targetProfile: ProfileLike | null
}): Promise<AdminLockoutVerdict> {
  const { action, actorId, targetId, targetProfile } = params
  if (!isAdminLockoutAction(action)) return PASS

  const targetIsActiveAdmin = isApprovedActiveAdmin(targetProfile)
  const remainingActiveAdminCount = targetIsActiveAdmin
    ? await countActiveAdminsExcluding([targetId])
    : 0

  return adminLockoutVerdict({
    action,
    actorId,
    targetId,
    targetIsActiveAdmin,
    remainingActiveAdminCount,
  })
}

/**
 * 여러 사람에게 같은 액션 — `/api/admin/members/bulk`.
 *
 * 관리자 수는 **한 번만** 센다. 대상에 든 관리자 전원을 한꺼번에 빼고 세야
 * "한 명씩 보면 매번 누군가 남아 보이지만 전부 처리하면 아무도 남지 않는"
 * 모양을 잡을 수 있다.
 *
 * @returns 막힌 대상만 담은 Map(대상 id → 판정). 통과한 대상은 들어오지 않는다.
 */
export async function adminLockoutVerdictsForBatch(params: {
  action: string
  actorId: string
  targets: { id: string; profile: ProfileLike | null }[]
}): Promise<Map<string, Extract<AdminLockoutVerdict, { blocked: true }>>> {
  const blocked = new Map<string, Extract<AdminLockoutVerdict, { blocked: true }>>()
  const { action, actorId, targets } = params
  if (!isAdminLockoutAction(action) || targets.length === 0) return blocked

  const adminTargetIds = targets.filter(t => isApprovedActiveAdmin(t.profile)).map(t => t.id)
  const remainingActiveAdminCount =
    adminTargetIds.length > 0 ? await countActiveAdminsExcluding(adminTargetIds) : 0

  for (const target of targets) {
    const verdict = adminLockoutVerdict({
      action,
      actorId,
      targetId: target.id,
      targetIsActiveAdmin: isApprovedActiveAdmin(target.profile),
      remainingActiveAdminCount,
    })
    if (verdict.blocked) blocked.set(target.id, verdict)
  }
  return blocked
}
