import { NextResponse } from 'next/server'

import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { requestWithdrawal, cancelWithdrawal } from '@/db/queries/withdrawal'

export const dynamic = 'force-dynamic'

/** 탈퇴 신청. 확정은 관리자가 한다 — 이 단계에서는 아무것도 지워지지 않는다. */
export async function POST() {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth

  const ok = await requestWithdrawal(auth.user.id)
  if (!ok) {
    return ApiError.conflict('지금 상태에서는 탈퇴를 신청할 수 없습니다.').toNextResponse()
  }
  return ApiSuccess.ok(
    { status: 'withdrawal_requested' },
    '탈퇴 신청이 접수되었습니다.'
  ).toNextResponse()
}

/** 신청 취소. 관리자가 확정하기 전까지 회원이 되돌릴 수 있다. */
export async function DELETE() {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth

  const ok = await cancelWithdrawal(auth.user.id)
  if (!ok) {
    return ApiError.conflict('취소할 탈퇴 신청이 없습니다.').toNextResponse()
  }
  return ApiSuccess.ok({ status: 'approved' }, '탈퇴 신청을 취소했습니다.').toNextResponse()
}
