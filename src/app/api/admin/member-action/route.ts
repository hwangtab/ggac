import { revalidatePath, revalidateTag } from 'next/cache'
import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { z } from 'zod'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { createLogger, maskId } from '@/utils/logger'
import { validateUUID } from '@/utils/validation'
import { getProfileById, updateProfile, type ProfilePatch } from '@/db/queries/profiles'
import { withdrawMember } from '@/db/queries/withdrawal'
import { notifyMemberApproved, notifyMemberRejected } from '@/lib/server/memberStatusNotify'
import { deleteBillingKey } from '@/lib/payments/toss/client'
import { getBillingConfig, isBillingEnabled } from '@/lib/payments/toss/config'
import { hasPublicBlobStore } from '@/lib/storage/blob'
import { deletePublicObject, logicalPathFromUrl } from '@/lib/storage/provider'
import { isProjectStorageObjectPath } from '@/utils/storageUrlValidation'
import { invalidateArtistsCache } from '@/lib/data'
import { getArtistCoreRevalidationPaths } from '@/lib/revalidationPaths'

const log = createLogger('admin/member-action')

const MemberActionSchema = z
  .object({
    memberId: z.string().uuid('유효하지 않은 멤버 ID입니다.'),
    action: z.enum([
      'approve',
      'reject',
      'activate',
      'deactivate',
      'suspend',
      'unsuspend',
      'withdraw',
    ]),
    suspension_reason: z.string().min(1).max(500).optional(),
    suspension_until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다.')
      .optional(),
  })
  .strict()
  .refine(
    data => {
      if (data.action === 'suspend') return true
      return data.suspension_reason === undefined && data.suspension_until === undefined
    },
    { message: '정지 액션 외에는 정지 관련 필드를 지정할 수 없습니다.' }
  )

type MemberActionInput = z.infer<typeof MemberActionSchema>

// API 라우트를 동적으로 렌더링하도록 강제 설정
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST: 회원 액션 처리 (단순한 경로로 우회)
export const POST = defineApiRoute<Record<string, unknown>>({
  method: 'POST',
  name: 'api/admin/member-action',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_member_action'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ body, auth }) => {
    let parsedInput: MemberActionInput | null = null

    try {
      const { user } = auth

      // 요청 데이터 파싱 및 Zod 검증
      const parsed = MemberActionSchema.safeParse(body)
      if (!parsed.success) {
        logSecurityEvent('INVALID_MEMBER_ACTION', { issues: parsed.error.flatten() }, 'medium')
        return ApiError.badRequest('유효하지 않은 요청입니다.').toNextResponse()
      }
      parsedInput = parsed.data
      const { action, suspension_reason, suspension_until } = parsedInput
      const memberIdValidation = validateUUID(parsedInput.memberId, '멤버 ID')
      if (!memberIdValidation.isValid) {
        return ApiError.badRequest(
          memberIdValidation.errors[0] || '유효하지 않은 멤버 ID입니다.'
        ).toNextResponse()
      }
      const memberId = memberIdValidation.sanitized

      // 대상 회원 정보 조회
      let targetMember: Awaited<ReturnType<typeof getProfileById>>
      try {
        targetMember = await getProfileById(memberId)
      } catch (error) {
        log.error('Target member fetch error', {
          message: error instanceof Error ? error.message : String(error),
          memberId: maskId(memberId),
        })
        return ApiError.notFound('회원을 찾을 수 없습니다.').toNextResponse()
      }

      if (!targetMember) {
        log.error('Target member fetch error', {
          message: 'not found',
          memberId: maskId(memberId),
        })
        return ApiError.notFound('회원을 찾을 수 없습니다.').toNextResponse()
      }

      // 탈퇴 확정은 되돌릴 수 없고 여러 표를 함께 정리하므로, 다른 액션처럼
      // `updateProfile`로 컬럼을 바꾸는 경로를 타지 않는다. 쿼리 계층의
      // 단일 트랜잭션(`withdrawMember`)이 전부 처리한다.
      if (action === 'withdraw') {
        if (memberId === user.id) {
          return ApiError.badRequest('자기 자신은 탈퇴 처리할 수 없습니다.').toNextResponse()
        }

        const outcome = await withdrawMember(memberId)
        // `strict: false`(strictNullChecks 꺼짐)에서는 `ok: true | false`
        // 같은 불리언 판별 유니언이 `!outcome.ok`로 좁혀지지 않는다(실측 —
        // outcome이 여전히 전체 유니언으로 남아 `reason`에 접근할 수 없다는
        // 타입 오류가 난다). `reason in outcome`은 이 설정에서도 좁혀진다.
        if ('reason' in outcome) {
          const message =
            outcome.reason === 'last_admin'
              ? '마지막 관리자는 탈퇴 처리할 수 없습니다. 다른 관리자를 먼저 지정해주세요.'
              : '탈퇴 신청 상태의 회원만 확정할 수 있습니다.'
          return ApiError.conflict(message).toNextResponse()
        }

        logSecurityEvent(
          'MEMBER_STATUS_CHANGED',
          { memberId: maskId(memberId), action, adminId: maskId(user.id) },
          'medium'
        )

        // 빌링키 행은 트랜잭션에서 이미 지워졌다. 토스 쪽 해지는 외부 호출이라
        // 트랜잭션 안에 넣으면 쓰기 락을 잡은 채 네트워크를 기다리게 된다.
        // 실패해도 탈퇴는 유효하다 — 우리 쪽 결제 수단은 이미 사라졌다.
        if (isBillingEnabled() && outcome.revokedBillingKeys.length > 0) {
          const { secretKey } = getBillingConfig()
          for (const billingKey of outcome.revokedBillingKeys) {
            try {
              await deleteBillingKey(billingKey, { secretKey })
            } catch (error) {
              log.error('탈퇴 확정 후 빌링키 삭제 실패', {
                memberId: maskId(memberId),
                error: error instanceof Error ? error.message : String(error),
              })
              logSecurityEvent(
                'BILLING_KEY_REVOKE_FAILED',
                { memberId: maskId(memberId) },
                'medium'
              )
            }
          }
        }

        // 연결된 아티스트가 있었다면 트랜잭션이 이미 `is_active=0`으로
        // 내리고 개인정보를 지웠다 — 남은 일은 Blob 사진(외부 호출이라
        // 트랜잭션 밖) 정리와 캐시 무효화뿐이다. 빌링키와 같은 이유로 커밋
        // 뒤에 한다.
        if (outcome.artistPhotoCleanup) {
          const { artistLegacyId, slug, profilePhotoUrl, profilePhotoMetadata } =
            outcome.artistPhotoCleanup

          if (!hasPublicBlobStore()) {
            // 삭제할 사진이 없으면(프로필 사진 없는 아티스트) 자격증명
            // 미설정을 굳이 경고할 필요가 없다.
            if (profilePhotoUrl) {
              log.error(
                'PUBLIC_BLOB_READ_WRITE_TOKEN 미설정 — 탈퇴 확정 후 아티스트 사진 삭제를 건너뛴다',
                { memberId: maskId(memberId) }
              )
            }
          } else {
            try {
              // `src/app/api/mypage/artist/photo/route.ts`의 DELETE와 같은
              // 방식 — 변형(webp·fallback)이 metadata.variants에 여럿 있을
              // 수 있으므로 그것부터 모으고, 없으면 profile_photo_url
              // 하나로 되돌아간다.
              const variants = (
                profilePhotoMetadata as { variants?: Record<string, unknown> } | null
              )?.variants
              const removalTargets = new Set<string>()
              for (const path of [variants?.original, variants?.webp, variants?.fallback]) {
                if (typeof path === 'string' && isProjectStorageObjectPath(path, artistLegacyId)) {
                  removalTargets.add(`artists/${path}`)
                }
              }
              if (removalTargets.size === 0 && profilePhotoUrl) {
                const legacyLogical = logicalPathFromUrl(profilePhotoUrl, 'artists', artistLegacyId)
                if (legacyLogical) removalTargets.add(legacyLogical)
              }

              if (removalTargets.size > 0) {
                const results = await Promise.allSettled(
                  Array.from(removalTargets).map(logical => deletePublicObject(logical))
                )
                for (const result of results) {
                  if (result.status === 'rejected') {
                    log.error('탈퇴 확정 후 아티스트 사진 삭제 실패', {
                      memberId: maskId(memberId),
                      error:
                        result.reason instanceof Error
                          ? result.reason.message
                          : String(result.reason),
                    })
                  }
                }
              }
            } catch (error) {
              log.error('탈퇴 확정 후 아티스트 사진 정리 중 오류', {
                memberId: maskId(memberId),
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          // 공개 페이지에서 즉시 내려가도록 캐시를 무효화한다 — 실패해도
          // 탈퇴 자체는 유효하다(ISR revalidate가 결국 따라잡는다).
          try {
            revalidateTag('artists')
            for (const path of getArtistCoreRevalidationPaths(slug)) {
              revalidatePath(path)
            }
            invalidateArtistsCache()
          } catch (error) {
            log.warn('탈퇴 확정 후 아티스트 캐시 무효화 실패', {
              memberId: maskId(memberId),
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        return ApiSuccess.ok({ status: 'withdrawn' }, '탈퇴가 확정되었습니다.').toNextResponse()
      }

      // 액션에 따른 업데이트 데이터 준비
      let updateData: ProfilePatch = {}

      switch (action) {
        case 'approve':
          if (targetMember.registration_status !== 'pending') {
            return ApiError.badRequest(
              '승인 대기 상태의 회원만 승인할 수 있습니다.'
            ).toNextResponse()
          }
          updateData = {
            registration_status: 'approved',
            is_active: true,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          }
          break

        case 'reject':
          if (targetMember.registration_status !== 'pending') {
            return ApiError.badRequest(
              '승인 대기 상태의 회원만 거부할 수 있습니다.'
            ).toNextResponse()
          }
          updateData = {
            registration_status: 'rejected',
            is_active: false,
            rejected_by: user.id,
          }
          break

        case 'activate':
          if (targetMember.registration_status !== 'approved') {
            return ApiError.badRequest('승인된 회원만 활성화할 수 있습니다.').toNextResponse()
          }
          updateData = {
            is_active: true,
          }
          break

        case 'deactivate':
          if (targetMember.registration_status !== 'approved') {
            return ApiError.badRequest('승인된 회원만 비활성화할 수 있습니다.').toNextResponse()
          }
          updateData = {
            is_active: false,
          }
          break

        case 'suspend':
          if (targetMember.registration_status !== 'approved') {
            return ApiError.badRequest('승인된 회원만 정지할 수 있습니다.').toNextResponse()
          }
          updateData = {
            is_suspended: true,
            is_active: false,
            suspension_reason: suspension_reason || '관리자에 의한 정지',
            suspension_until: suspension_until || null,
          }
          break

        case 'unsuspend':
          if (!targetMember.is_suspended) {
            return ApiError.badRequest('정지된 회원만 정지해제할 수 있습니다.').toNextResponse()
          }
          updateData = {
            is_suspended: false,
            is_active: true,
            suspension_reason: null,
            suspension_until: null,
          }
          break
      }

      // 데이터베이스 업데이트
      let updatedMember: Awaited<ReturnType<typeof getProfileById>>
      try {
        await updateProfile(memberId, updateData)
        updatedMember = await getProfileById(memberId)
      } catch (error) {
        log.error('Member update error', {
          message: error instanceof Error ? error.message : String(error),
          memberId: maskId(memberId),
          action,
        })
        return ApiError.internalServerError('회원 상태 업데이트에 실패했습니다.').toNextResponse()
      }

      // 상태 전이 알림. action이 'approve'/'reject'인 경로는 위에서 이미
      // `targetMember.registration_status !== 'pending'`이면 400으로
      // 빠졌으므로, 여기 도달했다는 것 자체가 pending → approved/rejected
      // 전이가 실제로 일어났다는 뜻이다(재조회로 다시 검사하지 않는다).
      // 실패는 로깅만 하고 응답을 막지 않는다(각 함수 내부에서 이미 흡수).
      if (action === 'approve') {
        await notifyMemberApproved(memberId)
      } else if (action === 'reject') {
        await notifyMemberRejected(memberId)
      }

      // 성공 응답
      const actionMessages: Record<string, string> = {
        approve: '승인',
        reject: '거부',
        activate: '활성화',
        deactivate: '비활성화',
        suspend: '정지',
        unsuspend: '정지해제',
      }

      // 보안 이벤트 로깅 — PII(원본 ID/표시명) 평문 노출 회피
      logSecurityEvent(
        'MEMBER_STATUS_CHANGED',
        {
          memberId: maskId(memberId),
          action,
          adminId: maskId(user.id),
        },
        'medium'
      )

      return ApiSuccess.ok(
        { member: updatedMember },
        `${targetMember.display_name}님이 ${actionMessages[action]}되었습니다.`
      )
    } catch (error) {
      log.error('Admin member action API error', error)
      logSecurityEvent(
        'ADMIN_MEMBER_ACTION_ERROR',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          action: parsedInput?.action,
        },
        'high'
      )
      return ApiError.internalServerError('회원 상태 변경 중 오류가 발생했습니다.').toNextResponse()
    }
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
