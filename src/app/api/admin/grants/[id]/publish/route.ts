/**
 * 지원사업 회차 발행. 게시글·인앱 알림·이메일이 여기서 나간다.
 *
 * 절차 자체는 `src/lib/server/grantPublish.ts`가 갖고 있고 여기는 **배선만** 한다 —
 * 조회로 재료를 모으고, 주입하고, 결과를 회차에 기록한다.
 */
import {
  claimGrantDigestForPublish,
  getGrantDigestById,
  updateGrantDigest,
} from '@/db/queries/grantDigests'
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

    // draft → publishing 조건부 선점. 동시에 두 요청이 여기 도달해도 UPDATE ... WHERE
    // status='draft'는 하나만 갱신된 행을 돌려준다 — 나머지는 null을 받고 400으로 빠진다.
    // 이 선점이 없으면 위의 존재·상태 확인과 아래 status:'published' 기록 사이에 경쟁
    // 창이 생겨, 같은 회차가 두 번 발행되면(더블클릭·재시도·관리자 두 명) 조합원
    // 전원에게 메일이 두 번 나간다 — 이미 나간 메일은 회수되지 않는다.
    const claimed = await claimGrantDigestForPublish(id)
    if (!claimed) {
      throw ApiError.badRequest('이미 발행 중이거나 발행된 회차입니다.')
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

    let result: Awaited<ReturnType<typeof runGrantPublish>>
    try {
      result = await runGrantPublish({
        digest: claimed,
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
    } catch (error) {
      // 게시글 생성 실패(runGrantPublish가 던지는 유일한 지점) — 선점을 되돌리지 않으면
      // 회차가 'publishing'에 영구히 갇혀 관리자가 다시 발행할 수 없다.
      try {
        await updateGrantDigest(id, { status: 'draft' })
      } catch (rollbackError) {
        log.error('발행 실패 후 draft 되돌리기 실패 — 회차가 publishing에 갇혔다', {
          digestId: id,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        })
      }
      throw error
    }

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
        weekKey: claimed.week_key,
        recipients: members.length,
        emailSent: result.email_sent,
        emailFailed: result.email_failed,
      },
      'medium'
    )

    return ApiSuccess.ok(result, '발행했습니다.')
  },
})
