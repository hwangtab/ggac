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
import { getUserSettingsByUserIds } from '@/db/queries/settings'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { sendEmail } from '@/lib/mail/send'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { runGrantPublish, summarizeMatchCounts, type SettingLike } from '@/lib/server/grantPublish'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'
import { getSiteUrl } from '@/utils/site'
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
      .map(r => ({
        id: r.id,
        email: r.email,
        display_name: r.display_name,
        interest_genres: r.interest_genres ?? [],
        interest_regions: r.interest_regions ?? [],
      }))

    // 회원별 설정을 **배치 한 번**으로 읽는다. 예전에는 회원마다 한 쿼리였고
    // (`Promise.all`이라 지연은 병렬이어도) 원격 커넥션에 회원 수만큼 왕복이
    // 꽂혔다. 기본값 합성은 단건 `getUserSettings`와 동일하다(그 함수 주석 참고).
    // 조회가 통째로 실패해도 발송을 막지 않는다 — 종전처럼 미설정과 같게 취급한다.
    let settingsByUserId = new Map<string, SettingLike[]>()
    try {
      settingsByUserId = (await getUserSettingsByUserIds(members.map(m => m.id))) as Map<
        string,
        SettingLike[]
      >
    } catch (error) {
      log.error('회원 설정 배치 조회 실패 — 전원을 미설정으로 취급한다', {
        recipients: members.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // 폴백 도메인을 여기에 따로 박으면 정본(`getSiteUrl()`)과 호스트가 갈린다
    // — 실제로 여기만 `www.` 붙은 다른 호스트였다. 링크는 메일로 나가므로
    // 절대 URL이어야 하고, `getSiteUrl()`이 그 판단을 한 곳에서 한다.
    const siteUrl = getSiteUrl()

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

    // 이 기록이 실패를 흡수하면 안 된다. 게시글은 나갔고 메일도 나갔는데 회차는
    // 'publishing'에 남는데, `claimGrantDigestForPublish`는 **draft만** 선점하므로
    // (grantDigests.ts) 관리자에게는 재시도 경로가 없다 — 회차 PATCH도 items만
    // 고친다. 그래서 여기서는 draft로 되돌리지 않는다(되돌리면 재발행이 가능해지고,
    // 그 재발행은 조합원 전원에게 **메일을 두 번** 보낸다. 회수되지 않는다).
    // 대신 사람이 손으로 고칠 수 있게 필요한 것(회차 id·게시글 id)을 로그와 응답에
    // 모두 남기고 500으로 끝낸다 — 관리자가 "발행됐다"고 오해하는 쪽이 더 나쁘다.
    try {
      await updateGrantDigest(id, {
        status: 'published',
        post_id: result.post_id,
        published_at: new Date().toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('발행 결과 기록 실패 — 게시글·메일은 나갔고 회차만 publishing에 갇혔다', {
        digestId: id,
        postId: result.post_id,
        error: message,
      })
      logSecurityEvent(
        'GRANT_DIGEST_PUBLISH_RECORD_FAILED',
        { adminId: maskId(adminId), digestId: id, postId: result.post_id, error: message },
        'high'
      )
      throw ApiError.internalServerError(
        `게시글(${result.post_id})은 발행됐지만 회차 상태 기록에 실패했습니다. ` +
          `회차 ${id}가 'publishing'에 갇혔으니 다시 발행하지 말고(메일이 두 번 나갑니다) ` +
          `상태를 손으로 'published'로 고쳐주세요.`
      )
    }

    // 건너뛴 사유를 뭉뚱그리지 않는다 — 수신거부·주소오류·0건매치는 뜻이 다르다.
    // 수신 건수 분포(matched*)도 함께 남긴다: zero_match_count만으로는 "0건은 아니지만
    // 적게 받은 사람"이 안 보인다 — kosmart 210명 카드 0장 사고의 이웃 사례다.
    const matchStats = summarizeMatchCounts(result.per_member.map(p => p.matched))
    logSecurityEvent(
      'GRANT_DIGEST_PUBLISHED',
      {
        adminId: maskId(adminId),
        digestId: id,
        weekKey: claimed.week_key,
        recipients: members.length,
        emailSent: result.email_sent,
        emailFailed: result.email_failed,
        emailSkippedOptout: result.email_skipped_optout,
        emailSkippedAddress: result.email_skipped_address,
        emailSkippedNomatch: result.email_skipped_nomatch,
        matchedMin: matchStats.min,
        matchedMedian: matchStats.median,
        matchedMax: matchStats.max,
      },
      'medium'
    )

    return ApiSuccess.ok(result, '발행했습니다.')
  },
})
