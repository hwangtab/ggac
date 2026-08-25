/**
 * 프로필 없는 계정("유령 회원")의 발견·복구 — 단계 4 Task 6b.
 *
 * ## 왜 이 라우트가 있는가
 *
 * 가입은 두 번 쓴다: Better Auth `user` 행(계정)과 `member_profiles` 행
 * (조합원 신청 정보). 둘 사이에서 프로필 쓰기가 실패하면 계정만 남는다.
 * 계정 생성 자체는 되돌릴 수 없다 — Better Auth의 `user.create.after` 훅은
 * `user` 행이 **커밋된 뒤** 실행되고(@better-auth/core의 `runWithTransaction`
 * 이 `pendingHooks`를 커밋 후에 돌린다), 거기서 던져 봐야 계정은 그대로 남고
 * 응답만 500이 된다. 그래서 가입 흐름은 계정을 남긴 채 회원에게 사실대로
 * 알린다(`/api/member-signup`의 202 응답: "사무국으로 문의해 주세요").
 *
 * 그 안내가 참이 되려면 사무국(관리자)에게 볼 수단과 고칠 수단이 있어야 한다.
 * 그전까지 이런 계정은 `member_profiles`만 읽는 관리자 회원 목록에 아예
 * 뜨지 않았고(`scripts/turso/README.md`가 미해결로 적어 둔 항목), 당사자는
 * `/register/pending`에 갇힌 채 재가입도 막혔다(`user.email` UNIQUE).
 *
 * - `GET`: 프로필 없는 계정 목록. 정상 상태에서는 빈 배열이다.
 * - `POST`: 그 계정에 승인 대기 프로필을 만들어 준다(복구).
 *
 * ## POST가 권한을 올려 줄 수 없는 이유
 *
 * 가입 훅과 **같은 빌더**(`buildMemberProfileRow`)를 쓴다. 그 빌더는
 * `registration_status: 'pending'` · `is_active/is_admin/is_director/
 * is_auditor: false`를 하드코딩하고 클라이언트 입력을 하나도 읽지 않는다.
 * 즉 복구의 결과는 "관리자 승인 화면에 뜨는 신청자"이지 승인된 회원이
 * 아니다. 승인은 기존 경로(`/api/admin/member-action`)로만 이뤄진다.
 *
 * 대상도 좁힌다 — `getProfilelessUserById`는 **프로필이 없는** 계정만
 * 돌려주므로, 이미 프로필이 있는 회원의 id를 넣어도 404가 되고 기존 행은
 * 건드려지지 않는다.
 */

import { z } from 'zod'

import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { createLogger, maskId } from '@/utils/logger'
import { buildMemberProfileRow } from '@/lib/auth/profileHook'
import {
  getProfilelessUserById,
  listProfilelessUsers,
  upsertProfile,
  type UpsertProfileInput,
} from '@/db/queries/profiles'

const log = createLogger('admin/members/orphans')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 목록 상한. 정상 상태에서는 0행이라 이 값은 "사고가 크게 났을 때 관리자
 * 화면과 응답이 통째로 터지지 않게" 하는 안전장치다.
 */
const ORPHAN_LIST_LIMIT = 100

const RecoverSchema = z.object({ userId: z.string().min(1).max(64) }).strict()

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/members/orphans',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_member_orphans'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  handler: async () => {
    const orphans = await listProfilelessUsers(ORPHAN_LIST_LIMIT)
    return ApiSuccess.ok({ orphans, limit: ORPHAN_LIST_LIMIT })
  },
})

export const POST = defineApiRoute<Record<string, unknown>>({
  method: 'POST',
  name: 'api/admin/members/orphans',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_member_orphans_recover'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ body, auth }) => {
    const parsed = RecoverSchema.safeParse(body)
    if (!parsed.success) {
      return ApiError.badRequest('userId가 필요합니다.').toNextResponse()
    }

    const orphan = await getProfilelessUserById(parsed.data.userId)
    if (!orphan) {
      // 계정이 없거나, 이미 프로필이 있는 회원이다. 둘을 구분해 알려 줄 이유가
      // 없다 — 어느 쪽이든 "이 라우트가 할 일이 없다"가 같은 답이다.
      return ApiError.notFound('프로필이 없는 계정을 찾지 못했습니다.').toNextResponse()
    }

    await upsertProfile(
      buildMemberProfileRow({
        id: orphan.id,
        email: orphan.email,
        name: orphan.name,
      }) as unknown as UpsertProfileInput
    )

    log.info('프로필 없는 계정 복구', {
      userId: maskId(orphan.id),
      by: maskId(auth.user.id),
    })
    logSecurityEvent(
      'ORPHAN_PROFILE_RECOVERED',
      { userId: maskId(orphan.id), by: maskId(auth.user.id) },
      'medium'
    )

    return ApiSuccess.created(
      { id: orphan.id },
      '승인 대기 상태로 프로필을 만들었습니다. 회원 목록에서 승인 여부를 결정해 주세요.'
    )
  },
})

export async function OPTIONS() {
  return createOptionsResponse()
}
