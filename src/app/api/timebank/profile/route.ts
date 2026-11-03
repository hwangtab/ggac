/**
 * 내 타임뱅크 프로필 — 읽기(GET)·고치기(PATCH) (스펙 §3 `timebank_profiles`).
 *
 * - 항상 **세션 회원 본인** 것만 다룬다. 경로·쿼리의 회원 id는 읽지 않는다.
 * - GET: `requireTimebankReader`(꺼져도 읽는다). 동의 상태를 함께 싣는다 — 화면이
 *   "동의하기 / 새 판에 다시 동의하기"를 고른다(§9.4).
 * - PATCH: `requireTimebankParticipant`. `visible = true`면 재능 디렉터리에 뜬다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPatch, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireTimebankParticipant, requireTimebankReader } from '@/lib/server/timebankAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseProfileInput } from '@/lib/timebank/validate'
import {
  getTimebankProfile,
  TimebankProfileInputError,
  upsertTimebankProfile,
} from '@/db/queries/timebankProfiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  return apiGet(
    async () => {
      const profile = await getTimebankProfile(user.id)
      const agreedVersion = profile?.agreed_at ? profile.terms_version : null
      return ApiSuccess.ok({
        profile,
        enabled: settings.enabled,
        terms: {
          current_version: settings.terms_version,
          agreed_version: agreedVersion,
          agreed_at: profile?.agreed_at ?? null,
          needs_agreement: agreedVersion !== settings.terms_version,
        },
      })
    },
    '/api/timebank/profile',
    { userId: user.id }
  )
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTimebankParticipant()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPatch(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const parsed = parseProfileInput(body)
      if (parsed.error !== null) throw ApiError.badRequest(parsed.error)

      try {
        const profile = await upsertTimebankProfile(user.id, parsed.value)
        return ApiSuccess.ok({ profile }, '프로필이 저장되었습니다.')
      } catch (error) {
        if (error instanceof TimebankProfileInputError) {
          throw ApiError.badRequest('입력 값이 올바르지 않습니다.')
        }
        throw error
      }
    },
    '/api/timebank/profile',
    { userId: user.id }
  )
}
