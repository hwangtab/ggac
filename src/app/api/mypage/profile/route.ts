import { NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ApiError, ApiSuccess, apiGet, apiPatch } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseIntegerParam } from '@/utils/queryParams'

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
  const monthlyFeeParam =
    typeof body.monthly_fee === 'number' || typeof body.monthly_fee === 'string'
      ? String(body.monthly_fee)
      : null
  const monthlyFee = parseIntegerParam(monthlyFeeParam, 0, { min: 0, max: 10_000_000 })
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

  const updateData = {
    display_name: displayName,
    phone_number: phoneNumber,
    birth_date: birthDate,
    monthly_fee: monthlyFee,
    bank_name: bankName,
    account_number: accountNumber,
    account_holder: accountHolder,
    updated_at: new Date().toISOString(),
  }

  return updateData
}

async function requireApprovedProfile() {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw ApiError.unauthorized('로그인이 필요합니다.')
  }

  const { data: profile, error } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    throw ApiError.notFound('프로필을 찾을 수 없습니다.')
  }

  if (profile.registration_status !== 'approved' || profile.is_active !== true) {
    throw ApiError.forbidden('승인된 활성 조합원만 프로필을 수정할 수 있습니다.')
  }

  return { supabase, user, profile }
}

export async function GET() {
  return apiGet(async () => {
    const { profile } = await requireApprovedProfile()
    return ApiSuccess.ok({ profile }, '프로필을 불러왔습니다.')
  }, '/api/mypage/profile')
}

export async function PATCH(request: NextRequest) {
  return apiPatch(async () => {
    const { supabase, user } = await requireApprovedProfile()
    const body = await parseJsonObjectBody(request)

    if (!body) {
      throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
    }

    const updateData = assertValidProfileBody(body)
    const { data: profile, error } = await supabase
      .from('member_profiles')
      .update(updateData as never)
      .eq('id', user.id)
      .select('*')
      .single()

    if (error || !profile) {
      throw ApiError.badRequest('프로필 업데이트에 실패했습니다.')
    }

    return ApiSuccess.ok({ profile }, '프로필이 업데이트되었습니다.')
  }, '/api/mypage/profile')
}
