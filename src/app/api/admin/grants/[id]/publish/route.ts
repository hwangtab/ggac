/**
 * 지원사업 회차 발행. 게시글·인앱 알림·이메일이 여기서 나간다.
 *
 * 절차 자체는 `src/lib/server/grantPublish.ts`가 갖고 있고 여기는 **배선만** 한다 —
 * 조회로 재료를 모으고, 주입하고, 결과를 회차에 기록한다.
 */
import { getGrantDigestById, updateGrantDigest } from '@/db/queries/grantDigests'
import { createBulkNotifications } from '@/db/queries/notifications'
import { createPost } from '@/db/queries/posts'
import { listProfiles } from '@/db/queries/profiles'
import { getUserSettings } from '@/db/queries/settings'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { sendEmail } from '@/lib/mail/send'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { runGrantPublish, type SettingLike } from '@/lib/server/grantPublish'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/admin/grants/publish')

export const runtime = 'nodejs'
/** 18통 순차 발송 + 게시글 + 알림. 조합원이 크게 늘면 이 값을 다시 본다. */
export const maxDuration = 300

/** 승인·활성 조합원. 필터 없는 목록 조회 상한 안에서 받아 메모리로 거른다(현재 23행). */
const MEMBER_FETCH_LIMIT = 1000

export const POST = defineApiRoute({
  method: 'POST',
  name: 'admin.grants.publish',
  rateLimit: { ...RATE_LIMITS.ADMIN_API, keyGenerator: createUserKeyGenerator('admin_grants') },
  rateLimitHeaders: true,
  auth: 'admin',
  handler: async ({ params, auth }) => {
    const id = String(params.id)
    const adminId = (auth as { user: { id: string } }).user.id

    const digest = await getGrantDigestById(id)
    if (!digest) throw ApiError.notFound('회차를 찾을 수 없습니다.')
    if (digest.status !== 'draft') {
      throw ApiError.badRequest('이미 발행되었거나 폐기된 회차입니다.')
    }

    const { rows } = await listProfiles({
      status: 'approved',
      limit: MEMBER_FETCH_LIMIT,
      offset: 0,
    })
    const members = rows
      .filter(r => r.is_active && !r.is_suspended)
      .map(r => ({ id: r.id, email: r.email, display_name: r.display_name }))

    // 회원별 설정. 18명 규모라 한 명씩 조회해도 충분하다.
    const settingsByUserId = new Map<string, SettingLike[]>()
    await Promise.all(
      members.map(async m => {
        try {
          settingsByUserId.set(m.id, (await getUserSettings(m.id)) as SettingLike[])
        } catch (error) {
          // 설정을 못 읽었다고 발송을 막지 않는다 — 미설정과 같게 취급한다.
          log.error('회원 설정 조회 실패', {
            userId: maskId(m.id),
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    )

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.ggac.kr'

    const result = await runGrantPublish({
      digest,
      authorId: adminId,
      members,
      settingsByUserId,
      siteUrl,
      now: new Date(),
      createPost: async input => createPost(input),
      createBulkNotifications: async input =>
        createBulkNotifications(input as Parameters<typeof createBulkNotifications>[0]),
      sendEmail,
      log,
    })

    await updateGrantDigest(id, {
      status: 'published',
      post_id: result.post_id,
      published_at: new Date().toISOString(),
    })

    logSecurityEvent(
      'GRANT_DIGEST_PUBLISHED',
      {
        adminId: maskId(adminId),
        digestId: id,
        weekKey: digest.week_key,
        recipients: members.length,
        emailSent: result.email_sent,
        emailFailed: result.email_failed,
      },
      'medium'
    )

    return ApiSuccess.ok(result, '발행했습니다.')
  },
})
