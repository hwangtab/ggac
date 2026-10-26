/**
 * 선점된 회차를 실제로 내보내는 배선. 관리자 화면의 발행 버튼(`/api/admin/grants/[id]/publish`)과
 * 크론 자동 발행(`/api/internal/grant-digest/publish`)이 **같은 코드**를 쓴다.
 *
 * 호출자가 할 일: 게시판 스위치 확인 → 회차 조회 → `claimGrantDigestForPublish` 선점.
 * 여기서 할 일: 회원·설정 수집 → `runGrantPublish` → 실패 시 draft 복구 / 성공 시 기록.
 *
 * 인증은 모른다 — 호출자가 판정한다.
 */
import { updateGrantDigest, type GrantDigestRow } from '@/db/queries/grantDigests'
import { createBulkNotifications } from '@/db/queries/notifications'
import { createPost } from '@/db/queries/posts'
import { listProfiles } from '@/db/queries/profiles'
import { getUserSettingsByUserIds } from '@/db/queries/settings'
import { sendEmail } from '@/lib/mail/send'
import { runGrantPublish, summarizeMatchCounts, type SettingLike } from '@/lib/server/grantPublish'
import { ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { getSiteUrl } from '@/utils/site'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('lib/server/grantPublishWiring')

/** 승인·활성 조합원. 필터 없는 목록 조회 상한 안에서 받아 메모리로 거른다(현재 23행). */
export const MEMBER_FETCH_LIMIT = 1000

export async function publishClaimedDigest(input: {
  claimed: GrantDigestRow
  authorId: string
  /** 보안 로그에 남길 행위자 표시(이미 마스킹된 값). 관리자 id 또는 'cron'. */
  actor: string
}): Promise<Awaited<ReturnType<typeof runGrantPublish>>> {
  const { claimed, authorId, actor } = input
  const id = claimed.id

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

  // 회원별 설정을 **배치 한 번**으로 읽는다. 조회가 통째로 실패해도 발송을 막지 않는다 —
  // 미설정과 같게 취급한다.
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

  // 링크는 메일로 나가므로 절대 URL이어야 한다. 판단은 `getSiteUrl()`이 한 곳에서 한다.
  const siteUrl = getSiteUrl()

  // 게시글이 만들어진 뒤의 실패는 draft로 되돌리면 안 된다 — 알림과 일부 메일이 이미
  // 나갔을 수 있고, 되돌리면 재시도가 게시글·메일을 **한 번 더** 보낸다. 그래서 되돌릴지는
  // "어디서 던졌나"를 추측하지 않고 게시글이 실제로 생겼는지로 정한다.
  let postCreated = false
  let result: Awaited<ReturnType<typeof runGrantPublish>>
  try {
    result = await runGrantPublish({
      digest: claimed,
      authorId,
      members,
      settingsByUserId,
      siteUrl,
      now: new Date(),
      createPost: async post => {
        const created = await createPost(post)
        postCreated = true
        return created
      },
      createBulkNotifications: async n =>
        createBulkNotifications(n as Parameters<typeof createBulkNotifications>[0]),
      sendEmail,
      log,
    })
  } catch (error) {
    if (postCreated) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('게시글 생성 뒤 발행 실패 — 회차를 publishing에 둔다', {
        digestId: id,
        error: message,
      })
      logSecurityEvent(
        'GRANT_DIGEST_PUBLISH_PARTIAL',
        { actor, digestId: id, error: message },
        'high'
      )
      throw ApiError.internalServerError(
        `게시글은 올라갔지만 알림·메일 발송 중 오류가 났습니다. 일부 메일이 이미 나갔을 수 ` +
          `있어 회차 ${id}를 'publishing'에 두었습니다. 다시 발행하지 말고 발송 기록을 확인해 주세요.`
      )
    }
    // 게시글 생성 실패 — 아무것도 나가지 않았다. 선점을 되돌리지 않으면 회차가
    // 'publishing'에 영구히 갇혀 다시 발행할 수 없다.
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

  // 이 기록이 실패를 흡수하면 안 된다. 게시글·메일은 나갔는데 회차는 'publishing'에 남고,
  // 선점은 draft만 받으므로 재시도 경로가 없다. draft로 되돌리지 않는다 — 되돌리면 재발행이
  // 가능해지고 메일이 두 번 나간다(회수되지 않는다). 사람이 고칠 수 있게 id를 남기고 500으로 끝낸다.
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
      { actor, digestId: id, postId: result.post_id, error: message },
      'high'
    )
    throw ApiError.internalServerError(
      `게시글(${result.post_id})은 발행됐지만 회차 상태 기록에 실패했습니다. ` +
        `회차 ${id}가 'publishing'에 갇혔으니 다시 발행하지 말고(메일이 두 번 나갑니다) ` +
        `상태를 손으로 'published'로 고쳐주세요.`
    )
  }

  // 건너뛴 사유를 뭉뚱그리지 않는다. 수신 건수 분포(matched*)도 함께 남긴다.
  const matchStats = summarizeMatchCounts(result.per_member.map(p => p.matched))
  logSecurityEvent(
    'GRANT_DIGEST_PUBLISHED',
    {
      actor,
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

  return result
}
