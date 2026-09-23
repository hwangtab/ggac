/**
 * 펀딩 알림 배선 — 인앱 알림(`notifications`)과 메일(Resend)을 실제로 낸다.
 * 문안과 수신자 판정은 `./notifyContent.ts`(순수 함수)에 있다.
 *
 * **이 모듈의 함수는 절대 던지지 않는다.** 부르는 자리가 전부 결제·심사
 * 흐름이고, 알림 하나가 결제를 되돌리거나 응답을 바꾸면 안 된다. 호출부가
 * `.catch()`로 감싸 두었어도 여기서 한 번 더 막는다 — `after()` 안에서
 * 던지면 잡아 줄 사람이 없다.
 *
 * **`RESEND_API_KEY`는 이 배포에서 선택값이다**(`CLAUDE.md`의 환경변수 표).
 * 키가 없으면 `sendEmail`이 던지는데, 그것이 호출부까지 올라가면 안 된다.
 * 없으면 메일을 아예 시도하지 않고 인앱 알림과 로그로 내려앉는다.
 *
 * **거래성 알림과 선택 알림.** 자기 돈에 관한 것(후원 완료·환불)은 영수증이라
 * 수신 설정과 무관하게 보낸다. 그 밖(심사 요청·승인·반려·마감·전달 시기 변경)은
 * `isEmailOptedOut`을 존중한다. 각 함수 머리에 어느 쪽인지 적어 두었다.
 */
import { getCampaignById } from '@/db/queries/funding'
import { listPaidPledgesByReward } from '@/db/queries/fundingPledges'
import { createBulkNotifications, createNotification } from '@/db/queries/notifications'
import type { NotificationTypeValue } from '@/db/queries/notifications'
import { getProfileById, listAdminRecipients } from '@/db/queries/profiles'
import { getUserSettings, getUserSettingsByUserIds } from '@/db/queries/settings'
import { sendEmail } from '@/lib/mail/send'
import { isEmailOptedOut } from '@/lib/server/grantPublish'
import { createLogger, maskId } from '@/utils/logger'
import { getSiteUrl } from '@/utils/site'

import {
  buildCampaignClosedNotice,
  buildCampaignReviewedNotice,
  buildCampaignSubmittedNotice,
  buildDeliveryChangedNotice,
  buildPledgePaidBackerNotice,
  buildPledgePaidCreatorNotice,
  buildPledgeRefundedNotice,
  isSendableEmail,
  maskEmail,
  pledgePaidBackerExtraLines,
  renderNoticeEmail,
  sendManyEmails,
  type DeliveryChangeLike,
  type NoticeCopy,
} from './notifyContent'

const log = createLogger('funding/notify')

const DAY_MS = 86_400_000
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString()
}

/** 메일을 보낼 수 있는 배포인가. 없으면 인앱 알림만 남기고 조용히 넘어간다. */
function isMailConfigured(): boolean {
  return typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.length > 0
}

/** 한 통. 실패·키 부재를 전부 삼킨다. */
async function sendOne(
  to: unknown,
  notice: NoticeCopy,
  extraLines: string[] = []
): Promise<boolean> {
  if (!isSendableEmail(to)) return false
  if (!isMailConfigured()) {
    log.warn('RESEND_API_KEY가 없어 펀딩 메일을 건너뜀', { notice: notice.title })
    return false
  }
  const { subject, html } = renderNoticeEmail(notice, extraLines)
  try {
    await sendEmail({ to, subject, html })
    return true
  } catch (error) {
    log.error('펀딩 메일 발송 실패', {
      to: maskEmail(to),
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** 인앱 알림 한 건. 비회원(userId 없음)은 만들 자리가 없으므로 건너뛴다. */
async function inApp(
  userId: unknown,
  type: NotificationTypeValue,
  notice: NoticeCopy,
  expiresInDays = 90
): Promise<void> {
  if (typeof userId !== 'string' || userId.length === 0) return
  try {
    await createNotification({
      user_id: userId,
      type,
      title: notice.title,
      message: notice.message,
      data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
      expires_at: daysFromNow(expiresInDays),
    })
  } catch (error) {
    log.error('펀딩 인앱 알림 생성 실패', {
      userId: maskId(userId),
      type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** 이 회원이 이메일 수신을 껐는가. 설정을 못 읽으면 "끄지 않았다"로 본다. */
async function optedOut(userId: string): Promise<boolean> {
  try {
    return isEmailOptedOut(await getUserSettings(userId))
  } catch (error) {
    log.warn('수신 설정 조회 실패 — 발송은 계속', {
      userId: maskId(userId),
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

// ---------------------------------------------------------------- ① 심사 요청

/**
 * 캠페인이 심사에 제출됐다 → **관리자 전원**.
 *
 * 관리자 말고는 승인·반려를 누를 수 없으므로 수신자가 관리자다.
 * **선택 알림** — 조합 운영 안내일 뿐 수신자의 돈이 걸린 일이 아니라
 * 이메일 수신거부를 존중한다(인앱 알림은 그대로 남는다).
 */
export async function notifyCampaignSubmitted(campaign: Record<string, unknown>): Promise<void> {
  try {
    const admins = await listAdminRecipients()
    if (admins.length === 0) {
      log.warn('펀딩 심사 알림을 받을 관리자가 없음', { campaignId: maskId(String(campaign.id)) })
      return
    }
    const notice = buildCampaignSubmittedNotice(campaign, getSiteUrl())

    try {
      await createBulkNotifications({
        user_ids: admins.map(a => a.id),
        type: 'funding_submitted',
        title: notice.title,
        message: notice.message,
        data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
        expires_at: daysFromNow(30),
      })
    } catch (error) {
      log.error('펀딩 심사 알림 일괄 생성 실패', {
        count: admins.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (!isMailConfigured()) return
    const settings = await getUserSettingsByUserIds(admins.map(a => a.id)).catch(() => new Map())
    const { subject, html } = renderNoticeEmail(notice)
    const result = await sendManyEmails({
      recipients: admins.map(a => ({ email: a.email, user_id: a.id, subject, html })),
      sendEmail,
      isOptedOut: id => isEmailOptedOut(settings.get(id)),
      log,
    })
    log.info('펀딩 심사 알림 발송', { campaignId: maskId(String(campaign.id)), ...result })
  } catch (error) {
    log.error('펀딩 심사 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ② 승인·반려

/**
 * 승인·반려 → **개설자**.
 *
 * 반려는 사유가 없으면 쓸모가 없다. `review_note`를 문장 안으로 가져온다
 * (대시보드에 가야만 보이는 값을 알림이 들고 온다).
 * **선택 알림** — 인앱은 항상, 메일은 수신거부를 존중한다.
 */
export async function notifyCampaignReviewed(
  campaign: Record<string, unknown>,
  action: 'approve' | 'reject'
): Promise<void> {
  try {
    const notice = buildCampaignReviewedNotice(campaign, action, getSiteUrl())
    const ownerId = campaign.owner_user_id
    await inApp(ownerId, action === 'approve' ? 'funding_approved' : 'funding_rejected', notice)
    await mailOwnerIfAllowed(ownerId, notice)
  } catch (error) {
    log.error('펀딩 심사 결과 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** 개설자에게 보내는 **선택** 알림의 메일 부분. 수신거부를 존중한다. */
async function mailOwnerIfAllowed(ownerId: unknown, notice: NoticeCopy): Promise<void> {
  if (typeof ownerId !== 'string' || ownerId.length === 0) return
  if (!isMailConfigured()) return
  if (await optedOut(ownerId)) return
  const owner = await getProfileById(ownerId).catch(() => null)
  await sendOne(owner?.email, notice)
}

// ---------------------------------------------------------------- ③ 후원 결제

/**
 * 후원 결제가 끝났다 → **후원자**와 **개설자**.
 *
 * 후원자에게는 **거래성**이다 — 자기 돈이 어디로 갔는지 알리는 영수이므로
 * 수신 설정을 보지 않는다. 비회원은 계정이 없어 인앱 알림을 만들 수 없으니
 * 메일이 유일한 통로다.
 *
 * 개설자에게는 **선택**이다(남의 결제 소식이지 자기 돈 이야기가 아니다).
 * 익명을 고른 후원자의 이름·이메일·배송지는 개설자에게 가지 않는다.
 */
export async function notifyPledgePaid(pledge: Record<string, unknown>): Promise<void> {
  try {
    const siteUrl = getSiteUrl()
    const campaign = pledge.campaign_id
      ? await getCampaignById(String(pledge.campaign_id)).catch(() => null)
      : null

    // 후원자 — 거래성. 인앱(회원일 때)과 메일 둘 다 수신 설정을 보지 않는다.
    const backerNotice = buildPledgePaidBackerNotice(pledge, campaign, siteUrl)
    await inApp(pledge.user_id, 'funding_pledged', backerNotice)
    await sendOne(pledge.backer_email, backerNotice, pledgePaidBackerExtraLines(pledge))

    // 개설자 — 선택.
    const ownerId = campaign?.owner_user_id
    if (typeof ownerId === 'string' && ownerId.length > 0 && ownerId !== pledge.user_id) {
      const creatorNotice = buildPledgePaidCreatorNotice(pledge, campaign, siteUrl)
      await inApp(ownerId, 'funding_pledged', creatorNotice)
      await mailOwnerIfAllowed(ownerId, creatorNotice)
    }
  } catch (error) {
    log.error('후원 완료 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ④ 마감

/**
 * 캠페인이 마감됐다 → **개설자**. 다음에 할 일(후원자 목록 확인·리워드 준비)을
 * 문장이 알려 준다. **선택 알림.**
 */
export async function notifyCampaignClosed(campaign: Record<string, unknown>): Promise<void> {
  try {
    const notice = buildCampaignClosedNotice(campaign, getSiteUrl())
    await inApp(campaign.owner_user_id, 'funding_closed', notice)
    await mailOwnerIfAllowed(campaign.owner_user_id, notice)
  } catch (error) {
    log.error('펀딩 마감 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ⑤ 전달 시기

/**
 * 리워드 전달 예정 시기가 바뀌었다 → **그 리워드를 후원한 사람들**.
 *
 * 약관 제12조가 "발송이 예정보다 늦어지는 경우 창작자가 후원자에게 알린다"고
 * 정한다. 지금까지는 활동 로그에만 남고 아무에게도 가지 않았다.
 *
 * **선택 알림** — 돈이 오가는 일이 아니므로 수신거부를 존중한다(비회원은
 * 설정 자체가 없어 그대로 받는다). 수신자가 상한을 넘으면 `sendManyEmails`가
 * 반쪽 발송 대신 통째로 포기하고 로그를 남긴다.
 */
export async function notifyRewardDeliveryChanged(
  campaign: Record<string, unknown>,
  changes: DeliveryChangeLike[]
): Promise<void> {
  if (!Array.isArray(changes) || changes.length === 0) return
  try {
    const siteUrl = getSiteUrl()
    for (const change of changes) {
      const backers = await listPaidPledgesByReward(change.reward_id).catch(() => [])
      if (backers.length === 0) continue

      const memberIds = backers
        .map(b => b.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      const settings =
        memberIds.length > 0
          ? await getUserSettingsByUserIds(memberIds).catch(() => new Map())
          : new Map()

      // 인앱은 회원에게만, 한 번의 배치 INSERT로.
      if (memberIds.length > 0) {
        const notice = buildDeliveryChangedNotice(change, campaign, { user_id: 'x' }, siteUrl)
        try {
          await createBulkNotifications({
            user_ids: [...new Set(memberIds)],
            type: 'funding_delivery_changed',
            title: notice.title,
            message: notice.message,
            data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
            expires_at: daysFromNow(180),
          })
        } catch (error) {
          log.error('전달 시기 변경 인앱 알림 실패', {
            rewardId: maskId(change.reward_id),
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (!isMailConfigured()) continue
      const result = await sendManyEmails({
        recipients: backers.map(b => {
          const notice = buildDeliveryChangedNotice(change, campaign, b, siteUrl)
          const { subject, html } = renderNoticeEmail(notice)
          return { email: b.backer_email, user_id: b.user_id, subject, html }
        }),
        sendEmail,
        isOptedOut: id => isEmailOptedOut(settings.get(id)),
        log,
      })
      log.info('전달 시기 변경 알림 발송', { rewardId: maskId(change.reward_id), ...result })
    }
  } catch (error) {
    log.error('전달 시기 변경 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ⑥ 환불

/**
 * 승인된 결제를 확정하지 못해 환불했다 → **후원자**.
 *
 * 만료 크론이 도는 자리다. 그 사람은 돈이 빠져나갔다가 돌아오는 것을 통장에서
 * 보는데 지금까지 아무 설명도 못 받았다.
 *
 * **거래성** — 자기 돈에 대한 통지라 수신 설정을 보지 않는다. 비회원이면
 * 메일뿐이다.
 */
export async function notifyPledgeRefunded(
  pledge: Record<string, unknown>,
  reason: 'reward_sold_out' | 'campaign_closed'
): Promise<void> {
  try {
    const notice = buildPledgeRefundedNotice(pledge, reason, getSiteUrl())
    await inApp(pledge.user_id, 'funding_refunded', notice)
    await sendOne(pledge.backer_email, notice)
  } catch (error) {
    log.error('후원 환불 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
