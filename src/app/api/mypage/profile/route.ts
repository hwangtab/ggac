import { NextRequest, NextResponse } from 'next/server'
import { ApiError, ApiSuccess, apiGet, apiPatch } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseMonthlyFee, MONTHLY_FEE_RANGE_MESSAGE } from '@/constants/memberProfile'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { getProfileById, updateProfile, type ProfilePatch } from '@/db/queries/profiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function normalizeRequiredText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function assertValidProfileBody(body: Record<string, unknown>) {
  const displayName = normalizeRequiredText(body.display_name, 80)
  const phoneNumber = normalizeRequiredText(body.phone_number, 40)
  const birthDate = normalizeOptionalText(body.birth_date, 10)
  // 사라진 `member_profiles_monthly_fee_check`(10000~50000)의 앱 재현.
  // 예전에는 여기서 0부터 천만 원까지를 통과시켰다 — 가입 라우트가 막던 값이
  // 프로필 수정으로는 그대로 들어갔고, DB에 CHECK가 없어 아무도 몰랐다.
  // (값을 안 보내면 0으로 떨어뜨려 저장했는데, 0도 원본 CHECK가 거부하던 값이다.)
  // 값을 안 보내면 NULL이다(원본 CHECK도 nullable 컬럼이라 NULL을 허용한다).
  const monthlyFeeResult = parseMonthlyFee(body.monthly_fee)
  if (!monthlyFeeResult.ok) {
    throw ApiError.badRequest(MONTHLY_FEE_RANGE_MESSAGE)
  }
  const monthlyFee = monthlyFeeResult.value
  const bankName = normalizeOptionalText(body.bank_name, 80)
  const accountNumber = normalizeOptionalText(body.account_number, 80)
  const accountHolder = normalizeOptionalText(body.account_holder, 80)

  if (!displayName) {
    throw ApiError.badRequest('표시 이름은 필수입니다.')
  }

  if (!phoneNumber) {
    throw ApiError.badRequest('전화번호는 필수입니다.')
  }

  if (!/^[\d\-+()\s]+$/.test(phoneNumber)) {
    throw ApiError.badRequest('올바른 전화번호 형식이 아닙니다.')
  }

  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw ApiError.badRequest('올바른 날짜 형식이 아닙니다. (YYYY-MM-DD)')
  }

  if (accountNumber && !bankName) {
    throw ApiError.badRequest('계좌번호가 있으면 은행명도 입력해주세요.')
  }

  if (bankName && !accountNumber) {
    throw ApiError.badRequest('은행명이 있으면 계좌번호도 입력해주세요.')
  }

  const updateData: ProfilePatch = {
    display_name: displayName,
    phone_number: phoneNumber,
    birth_date: birthDate,
    monthly_fee: monthlyFee,
    bank_name: bankName,
    account_number: accountNumber,
    account_holder: accountHolder,
  }

  return updateData
}

export async function GET() {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(async () => {
    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      profile = await getProfileById(user.id)
    } catch {
      profile = null
    }

    if (!profile) {
      throw ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.')
    }

    return ApiSuccess.ok({ profile }, '프로필을 불러왔습니다.')
  }, '/api/mypage/profile')
}

export async function PATCH(request: NextRequest) {
  // 프로필 갱신 남용 방지 (전수감사 안정성 M-4)
  const rl = await rateLimit(request, 'GENERAL_API')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPatch(async () => {
    const body = await parseJsonObjectBody(request)

    if (!body) {
      throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
    }

    const updateData = assertValidProfileBody(body)
    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      await updateProfile(user.id, updateData)
      profile = await getProfileById(user.id)
    } catch {
      profile = null
    }

    if (!profile) {
      throw ApiError.badRequest('프로필 업데이트에 실패했습니다.')
    }

    return ApiSuccess.ok({ profile }, '프로필이 업데이트되었습니다.')
  }, '/api/mypage/profile')
}
