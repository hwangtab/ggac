/**
 * 펀딩 알림 배선 — 인앱 알림(`notifications`)과 메일(Resend)을 실제로 낸다.
 * 문안과 수신자 판정은 `./notifyContent.ts`(순수 함수)에 있다.
 *
 * **의존성은 전부 주입받는다.** 기본값은 진짜 모듈이고, 호출부는 그냥 부르면
 * 된다. 두 번째 인자로 대역을 넘길 수 있어야 하는 이유는 `grantPublish.ts`와
 * 같다 — "키가 없으면 메일을 시도하지 않는가", "비회원에게 인앱 알림을 만들지
 * 않는가", "익명 후원자의 이름이 개설자에게 가지 않는가"를 네트워크도 DB도
 * 없이 고정해야 한다. 코드리뷰에서 실측된 것: 이 파일을 부르는 테스트가 하나도
 * 없어 `notifyPledgePaid` 첫 줄에 `if (1) return`을 넣어도 전 스위트가
 * 초록불이었다.
 *
 * 로컬 import는 `.ts`를 명시한다(`@/` 별칭 대신) — 그래야 `node --test`가 이
 * 모듈을 그대로 불러올 수 있다. DB 클라이언트는 실제 쿼리 시점까지 생성이
 * 미뤄지므로(`src/db/client.ts`의 lazy proxy) 임포트만으로는 접속하지 않는다.
 *
 * **이 모듈의 함수는 절대 던지지 않는다.** 부르는 자리가 전부 결제·심사
 * 흐름이고, 알림 하나가 결제를 되돌리거나 응답을 바꾸면 안 된다.
 *
 * **`RESEND_API_KEY`는 이 배포에서 선택값이다**(`CLAUDE.md`의 환경변수 표).
 * 없으면 메일을 아예 시도하지 않고 인앱 알림과 로그로 내려앉는다.
 *
 * **거래성과 선택.** 자기 돈에 관한 것(후원 완료·환불)은 영수라 수신 설정과
 * 무관하게 보낸다. 그 밖은 `isEmailOptedOut`을 존중한다. 각 함수 머리에 어느
 * 쪽인지 적어 두었다.
 */
import {
  listRecentTargetActivities,
  type ActivityActionTypeValue,
} from '../../db/queries/activities.ts'
import { getCampaignById } from '../../db/queries/funding.ts'
import { listPaidPledgesByReward } from '../../db/queries/fundingPledges.ts'
import {
  createBulkNotifications,
  createNotification,
  hasRecentSystemNotice,
  type NotificationTypeValue,
} from '../../db/queries/notifications.ts'
import { getProfileEmail, listAdminRecipients } from '../../db/queries/profiles.ts'
import { getUserSettings, getUserSettingsByUserIds } from '../../db/queries/settings.ts'
import { sendEmail } from '../mail/send.ts'
import { isEmailOptedOut, type SettingLike } from '../server/grantPublish.ts'
import { createLogger, maskId } from '../../utils/logger.ts'
import { getSiteUrl } from '../../utils/site.ts'

import {
  DELIVERY_REWARD_LIMIT,
  SUBMIT_DAILY_LIMIT,
  THROTTLE_WINDOW_MS,
  decideCampaignSubmittedNotice,
  decideDeliveryChangeNotice,
  type ThrottleLedgerEntry,
} from './notifyThrottle.ts'
import {
  MAX_BULK_RECIPIENTS,
  buildBulkAbandonedNotice,
  buildCampaignClosedNotice,
  buildCampaignReviewedNotice,
  buildCampaignSubmittedNotice,
  buildDeliveryChangedNotice,
  buildPledgePaidBackerNotice,
  buildPledgePaidCreatorNotice,
  buildPledgeRefundedNotice,
  buildPledgeShippedNotice,
  buildSettlementPaidNotice,
  buildSettlementPreparedNotice,
  buildRefundAfterPayoutNotice,
  buildStuckHoldsNotice,
  isSendableEmail,
  maskEmail,
  pledgePaidBackerExtraLines,
  renderNoticeEmail,
  sendManyEmails,
  type DeliveryChangeLike,
  type NoticeCopy,
  type SettlementLike,
} from './notifyContent.ts'

const log = createLogger('funding/notify')

const DAY_MS = 86_400_000
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString()
}

// ---------------------------------------------------------------- 의존성

export interface NotifyDeps {
  getCampaignById: (id: string) => Promise<Record<string, unknown> | null>
  listPaidPledgesByReward: (rewardId: string) => Promise<Record<string, unknown>[]>
  listAdminRecipients: () => Promise<{ id: string; email: string | null }[]>
  /** 알림 억제 판정의 근거. 자세한 이유는 `./notifyThrottle.ts` 머리 주석. */
  listRecentTargetActivities: (filter: {
    actionTypes: ActivityActionTypeValue[]
    targetType: 'funding_campaign'
    targetId?: string | null
    since: Date
    excludeId?: string | null
  }) => Promise<
    { created_at: string; target_id: string | null; metadata: Record<string, unknown> }[]
  >
  getProfileEmail: (id: string) => Promise<string | null>
  getUserSettings: (userId: string) => Promise<SettingLike[]>
  getUserSettingsByUserIds: (ids: string[]) => Promise<Map<string, SettingLike[]>>
  createNotification: (input: Record<string, unknown>) => Promise<unknown>
  createBulkNotifications: (input: Record<string, unknown>) => Promise<unknown>
  /** 같은 종류의 시스템 공지를 최근에 이미 냈는가 — 크론이 매번 다시 알리지 않게. */
  hasRecentSystemNotice: (kind: string, since: Date) => Promise<boolean>
  sendEmail: (mail: { to: string; subject: string; html: string }) => Promise<void>
  /** 메일을 보낼 수 있는 배포인가. `RESEND_API_KEY`가 있으면 참. */
  isMailConfigured: () => boolean
  siteUrl: () => string
  log: {
    info: (msg: string, meta?: unknown) => void
    warn: (msg: string, meta?: unknown) => void
    error: (msg: string, meta?: unknown) => void
  }
}

const realDeps: NotifyDeps = {
  getCampaignById,
  listPaidPledgesByReward,
  listAdminRecipients,
  listRecentTargetActivities,
  getProfileEmail,
  getUserSettings,
  getUserSettingsByUserIds,
  createNotification: input => createNotification(input as never),
  createBulkNotifications: input => createBulkNotifications(input as never),
  hasRecentSystemNotice,
  sendEmail,
  isMailConfigured: () =>
    typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.length > 0,
  siteUrl: getSiteUrl,
  log,
}

function resolve(overrides?: Partial<NotifyDeps>): NotifyDeps {
  return overrides ? { ...realDeps, ...overrides } : realDeps
}

// ---------------------------------------------------------------- 공통 동작

/** 한 통. 실패·키 부재를 전부 삼킨다. */
async function sendOne(
  d: NotifyDeps,
  to: unknown,
  notice: NoticeCopy,
  extraLines: string[] = []
): Promise<boolean> {
  if (!isSendableEmail(to)) return false
  if (!d.isMailConfigured()) {
    d.log.warn('RESEND_API_KEY가 없어 펀딩 메일을 건너뜀', { notice: notice.title })
    return false
  }
  const { subject, html } = renderNoticeEmail(notice, extraLines)
  try {
    await d.sendEmail({ to, subject, html })
    return true
  } catch (error) {
    d.log.error('펀딩 메일 발송 실패', {
      to: maskEmail(to),
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** 인앱 알림 한 건. 비회원(userId 없음)은 만들 자리가 없으므로 건너뛴다. */
async function inApp(
  d: NotifyDeps,
  userId: unknown,
  type: NotificationTypeValue,
  notice: NoticeCopy,
  expiresInDays = 90
): Promise<void> {
  if (typeof userId !== 'string' || userId.length === 0) return
  try {
    await d.createNotification({
      user_id: userId,
      type,
      title: notice.title,
      message: notice.message,
      data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
      expires_at: daysFromNow(expiresInDays),
    })
  } catch (error) {
    d.log.error('펀딩 인앱 알림 생성 실패', {
      userId: maskId(userId),
      type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** 이 회원이 이메일 수신을 껐는가. 설정을 못 읽으면 "끄지 않았다"로 본다. */
async function optedOut(d: NotifyDeps, userId: string): Promise<boolean> {
  try {
    return isEmailOptedOut(await d.getUserSettings(userId))
  } catch (error) {
    d.log.warn('수신 설정 조회 실패 — 발송은 계속', {
      userId: maskId(userId),
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** 개설자에게 보내는 **선택** 알림의 메일 부분. 수신거부를 존중한다. */
async function mailOwnerIfAllowed(
  d: NotifyDeps,
  ownerId: unknown,
  notice: NoticeCopy
): Promise<void> {
  if (typeof ownerId !== 'string' || ownerId.length === 0) return
  if (!d.isMailConfigured()) return
  if (await optedOut(d, ownerId)) return
  // 주소 한 칸만 읽는다 — 전체 행을 받으면 계좌번호·생년월일이 딸려 온다.
  const email = await d.getProfileEmail(ownerId).catch(() => null)
  await sendOne(d, email, notice)
}

/**
 * 개설자에게 보내는 **거래성** 알림의 메일 부분. 수신거부를 보지 않는다.
 *
 * 자기 돈이 실제로 움직였다는 통지에만 쓴다(정산금 지급). "조합 소식은 그만"
 * 이라고 껐다고 해서 "당신 돈을 보냈습니다"를 안 보낼 수는 없다 — 후원 완료·
 * 환불 통지가 후원자에게 그러한 것과 같은 판단이다.
 */
async function mailOwnerAlways(d: NotifyDeps, ownerId: unknown, notice: NoticeCopy): Promise<void> {
  if (typeof ownerId !== 'string' || ownerId.length === 0) return
  if (!d.isMailConfigured()) return
  // 주소 한 칸만 읽는다 — 전체 행을 받으면 계좌번호·생년월일이 딸려 온다.
  const email = await d.getProfileEmail(ownerId).catch(() => null)
  await sendOne(d, email, notice)
}

/**
 * 알림을 낼 자리에서 부르는 **동작 반복 감지자**.
 *
 * 무엇을 근거로 세는지와 왜 그렇게 정했는지는 `./notifyThrottle.ts` 머리
 * 주석에 있다. 여기서 정하는 것은 **못 읽었을 때 어느 쪽으로 기우는가**뿐이다
 * — 빈 목록을 돌려 **발송 쪽으로** 기운다. 조회가 흔들렸다고 승인·마감 같은
 * 알림이 조용히 사라지면, 고치기 어려운 쪽(사람이 소식을 못 받는 쪽)으로
 * 무너진다.
 */
async function readThrottleLedger(
  d: NotifyDeps,
  actionType: ActivityActionTypeValue,
  targetId: string | null,
  excludeId?: string | null
): Promise<ThrottleLedgerEntry[]> {
  try {
    const rows = await d.listRecentTargetActivities({
      actionTypes: [actionType],
      targetType: 'funding_campaign',
      targetId,
      since: new Date(Date.now() - THROTTLE_WINDOW_MS),
      excludeId: excludeId ?? null,
    })
    return rows.map(r => ({
      created_at: r.created_at,
      target_id: r.target_id,
      metadata: r.metadata,
    }))
  } catch (error) {
    d.log.warn('알림 억제 판정용 활동 기록 조회 실패 — 발송은 계속', {
      actionType,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/** 알림 함수가 라우트에서 받는 곁정보. */
export interface NotifyThrottleOptions {
  /**
   * 이 동작을 남긴 활동 기록의 id. 억제 판정에서 **뺀다** — 방금 남긴 "지금
   * 이 동작"이 "직전에도 있었다"로 읽히면 첫 알림부터 막힌다. 라우트가
   * `logUserActivity`를 기다렸다 받은 값을 넘긴다.
   */
  activityId?: string | null
}

/**
 * 자동 발송을 포기했다는 것을 관리자에게 알린다.
 *
 * 상한을 넘은 건은 아무에게도 가지 않는다. 그 사실을 **손으로 보낼 수 있는
 * 사람**이 알아야 한다 — Vercel 런타임 로그는 이 조합에서 아무도 보지 않는다.
 */
async function tellAdminsSendAbandoned(
  d: NotifyDeps,
  campaign: Record<string, unknown>,
  what: string,
  recipientCount: number
): Promise<void> {
  try {
    const admins = await d.listAdminRecipients()
    if (admins.length === 0) return
    const notice = buildBulkAbandonedNotice(
      campaign,
      what,
      recipientCount,
      MAX_BULK_RECIPIENTS,
      d.siteUrl()
    )
    await d.createBulkNotifications({
      user_ids: admins.map(a => a.id),
      type: 'system_notice',
      title: notice.title,
      message: notice.message,
      data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
      expires_at: daysFromNow(30),
    })
    if (!d.isMailConfigured()) return
    const { subject, html } = renderNoticeEmail(notice)
    await sendManyEmails({
      recipients: admins.map(a => ({ email: a.email, user_id: a.id, subject, html })),
      sendEmail: d.sendEmail,
      log: d.log,
    })
  } catch (error) {
    d.log.error('자동 발송 포기 통지 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ① 심사 요청

/**
 * 캠페인이 심사에 제출됐다 → **관리자 전원**.
 *
 * 관리자 말고는 승인·반려를 누를 수 없으므로 수신자가 관리자다.
 * **선택 알림** — 조합 운영 안내일 뿐 수신자의 돈이 걸린 일이 아니라
 * 이메일 수신거부를 존중한다(인앱 알림은 그대로 남는다).
 *
 * 제출은 개설자가 누르는 동작이고 철회와 짝이라 **얼마든지 반복된다.**
 * 30분 안의 재제출은 같은 말이므로 내지 않고, 하루 상한을 넘긴 뒤로는 인앱만
 * 남긴다(`./notifyThrottle.ts`).
 */
export async function notifyCampaignSubmitted(
  campaign: Record<string, unknown>,
  options: NotifyThrottleOptions = {},
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const campaignId = String(campaign.id ?? '')
    const decision = decideCampaignSubmittedNotice({
      campaignId,
      entries: await readThrottleLedger(d, 'funding_campaign_submitted', null, options.activityId),
    })
    if (decision === 'skip') {
      d.log.info('직전에 같은 심사 요청을 알려 두었으므로 다시 알리지 않음', {
        campaignId: maskId(campaignId),
      })
      return
    }

    const admins = await d.listAdminRecipients()
    if (admins.length === 0) {
      d.log.warn('펀딩 심사 알림을 받을 관리자가 없음', {
        campaignId: maskId(String(campaign.id)),
      })
      return
    }
    const notice = buildCampaignSubmittedNotice(campaign, d.siteUrl())

    try {
      await d.createBulkNotifications({
        user_ids: admins.map(a => a.id),
        type: 'funding_submitted',
        title: notice.title,
        message: notice.message,
        data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
        expires_at: daysFromNow(30),
      })
    } catch (error) {
      d.log.error('펀딩 심사 알림 일괄 생성 실패', {
        count: admins.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (decision === 'in_app_only') {
      d.log.warn('심사 요청 알림이 하루 상한에 닿아 메일은 보내지 않음', {
        campaignId: maskId(campaignId),
        limit: SUBMIT_DAILY_LIMIT,
      })
      return
    }

    if (!d.isMailConfigured()) return
    const settings = await d
      .getUserSettingsByUserIds(admins.map(a => a.id))
      .catch(() => new Map<string, SettingLike[]>())
    const { subject, html } = renderNoticeEmail(notice)
    const result = await sendManyEmails({
      recipients: admins.map(a => ({ email: a.email, user_id: a.id, subject, html })),
      sendEmail: d.sendEmail,
      isOptedOut: id => isEmailOptedOut(settings.get(id)),
      log: d.log,
    })
    d.log.info('펀딩 심사 알림 발송', { campaignId: maskId(String(campaign.id)), ...result })
  } catch (error) {
    d.log.error('펀딩 심사 알림 실패', {
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
  action: 'approve' | 'reject',
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const notice = buildCampaignReviewedNotice(campaign, action, d.siteUrl())
    const ownerId = campaign.owner_user_id
    await inApp(d, ownerId, action === 'approve' ? 'funding_approved' : 'funding_rejected', notice)
    await mailOwnerIfAllowed(d, ownerId, notice)
  } catch (error) {
    d.log.error('펀딩 심사 결과 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
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
 * 자기 프로젝트에 자기가 후원하면 개설자 몫은 보내지 않는다 — 같은 사람이다.
 */
export async function notifyPledgePaid(
  pledge: Record<string, unknown>,
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const siteUrl = d.siteUrl()
    const campaign = pledge.campaign_id
      ? await d.getCampaignById(String(pledge.campaign_id)).catch(() => null)
      : null

    // 후원자 — 거래성. 인앱(회원일 때)과 메일 둘 다 수신 설정을 보지 않는다.
    const backerNotice = buildPledgePaidBackerNotice(pledge, campaign, siteUrl)
    await inApp(d, pledge.user_id, 'funding_pledged', backerNotice)
    await sendOne(d, pledge.backer_email, backerNotice, pledgePaidBackerExtraLines(pledge))

    // 개설자 — 선택.
    const ownerId = campaign?.owner_user_id
    if (typeof ownerId === 'string' && ownerId.length > 0 && ownerId !== pledge.user_id) {
      const creatorNotice = buildPledgePaidCreatorNotice(pledge, campaign, siteUrl)
      await inApp(d, ownerId, 'funding_pledged', creatorNotice)
      await mailOwnerIfAllowed(d, ownerId, creatorNotice)
    }
  } catch (error) {
    d.log.error('후원 완료 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ④ 마감

/**
 * 캠페인이 마감됐다 → **개설자**. 다음에 할 일(후원자 목록 확인·리워드 준비)을
 * 문장이 알려 준다. **선택 알림.**
 */
export async function notifyCampaignClosed(
  campaign: Record<string, unknown>,
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const notice = buildCampaignClosedNotice(campaign, d.siteUrl())
    await inApp(d, campaign.owner_user_id, 'funding_closed', notice)
    await mailOwnerIfAllowed(d, campaign.owner_user_id, notice)
  } catch (error) {
    d.log.error('펀딩 마감 알림 실패', {
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
 * 설정 자체가 없어 그대로 받는다). 수신자가 상한을 넘으면 반쪽 발송 대신
 * 통째로 포기하고, **관리자에게 그 사실을 알린다.**
 *
 * 예상 전달월은 잠기지 않아 개설자가 몇 번이든 되돌릴 수 있고, 저장 한 번이
 * 후원자 전원에게 메일이다. 그래서 **리워드마다 하루 한 번만 메일로** 알린다
 * — 같은 리워드가 하루에 또 바뀌면 회원 후원자에게 인앱으로만 가고, 하루에
 * 세 번을 넘기면 아무것도 내지 않는다(`./notifyThrottle.ts`).
 */
export async function notifyRewardDeliveryChanged(
  campaign: Record<string, unknown>,
  changes: DeliveryChangeLike[],
  options: NotifyThrottleOptions = {},
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  if (!Array.isArray(changes) || changes.length === 0) return
  const d = resolve(overrides)
  try {
    const siteUrl = d.siteUrl()
    const campaignId = String(campaign.id ?? '')
    // 기록은 캠페인 단위로 한 번만 읽고, 판정은 리워드마다 따로 한다 — 여러
    // 리워드가 한꺼번에 밀리는 저장은 정직한 한 번의 동작이라 서로를 막으면
    // 안 된다.
    const ledger = await readThrottleLedger(
      d,
      'funding_reward_delivery_changed',
      campaignId.length > 0 ? campaignId : null,
      options.activityId
    )
    for (const change of changes) {
      const decision = decideDeliveryChangeNotice({
        rewardId: change.reward_id,
        entries: ledger,
      })
      if (decision === 'skip') {
        d.log.warn('전달 시기 변경이 하루 상한을 넘어 아무에게도 알리지 않음', {
          campaignId: maskId(campaignId),
          rewardId: maskId(change.reward_id),
          limit: DELIVERY_REWARD_LIMIT,
        })
        continue
      }

      const backers = await d.listPaidPledgesByReward(change.reward_id).catch(() => [])
      if (backers.length === 0) continue

      if (backers.length > MAX_BULK_RECIPIENTS) {
        await tellAdminsSendAbandoned(
          d,
          campaign,
          `'${change.reward_title}' 리워드 전달 예정 시기 변경`,
          backers.length
        )
        continue
      }

      const memberIds = backers
        .map(b => b.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      const settings =
        memberIds.length > 0
          ? await d
              .getUserSettingsByUserIds(memberIds)
              .catch(() => new Map<string, SettingLike[]>())
          : new Map<string, SettingLike[]>()

      // 인앱은 회원에게만, 한 번의 배치 INSERT로.
      if (memberIds.length > 0) {
        const notice = buildDeliveryChangedNotice(change, campaign, { user_id: 'x' }, siteUrl)
        try {
          await d.createBulkNotifications({
            user_ids: [...new Set(memberIds)],
            type: 'funding_delivery_changed',
            title: notice.title,
            message: notice.message,
            data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
            expires_at: daysFromNow(180),
          })
        } catch (error) {
          d.log.error('전달 시기 변경 인앱 알림 실패', {
            rewardId: maskId(change.reward_id),
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (decision === 'in_app_only') {
        d.log.info('오늘 이미 알린 리워드라 메일은 보내지 않고 인앱만 남김', {
          campaignId: maskId(campaignId),
          rewardId: maskId(change.reward_id),
        })
        continue
      }

      if (!d.isMailConfigured()) continue
      const result = await sendManyEmails({
        recipients: backers.map(b => {
          const notice = buildDeliveryChangedNotice(change, campaign, b, siteUrl)
          const { subject, html } = renderNoticeEmail(notice)
          return { email: b.backer_email, user_id: b.user_id, subject, html }
        }),
        sendEmail: d.sendEmail,
        isOptedOut: id => isEmailOptedOut(settings.get(id)),
        log: d.log,
      })
      d.log.info('전달 시기 변경 알림 발송', { rewardId: maskId(change.reward_id), ...result })
    }
  } catch (error) {
    d.log.error('전달 시기 변경 알림 실패', {
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
 * 메일뿐이고, 그래서 문장이 후원번호를 함께 들고 간다.
 */
export async function notifyPledgeRefunded(
  pledge: Record<string, unknown>,
  reason: 'reward_sold_out' | 'campaign_closed',
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const notice = buildPledgeRefundedNotice(pledge, reason, d.siteUrl())
    await inApp(d, pledge.user_id, 'funding_refunded', notice)
    await sendOne(d, pledge.backer_email, notice)
  } catch (error) {
    d.log.error('후원 환불 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ⑧ 발송

/**
 * 리워드를 보냈다 → **그 후원의 후원자들**.
 *
 * 개설자가 이행 상태를 발송 경계 위로 옮긴 **그 건들만** 받는다 — 무엇이
 * 경계를 넘었는지는 이 모듈이 아니라 전이 표(`./fulfillment.ts`)와 조건부
 * 쓰기가 판정하고, 여기는 넘은 것들을 통지할 뿐이다.
 *
 * **선택 알림.** 수신거부를 존중한다. 비회원은 인앱 알림을 만들 자리가 없어
 * 메일뿐이고, 그래서 문장이 후원번호를 들고 간다.
 *
 * 인앱은 **리워드별로 묶어** 한 번씩 INSERT한다 — 문장이 리워드 이름을 담기
 * 때문에 서로 다른 리워드를 한 배치에 넣으면 남의 리워드 이름을 보게 된다.
 *
 * 수신자가 상한을 넘으면 반쪽 발송 대신 통째로 포기하고 관리자에게 알린다
 * (전달 시기 변경과 같은 판단).
 */
export async function notifyPledgesShipped(
  campaign: Record<string, unknown>,
  pledges: Record<string, unknown>[],
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  if (!Array.isArray(pledges) || pledges.length === 0) return
  const d = resolve(overrides)
  try {
    const siteUrl = d.siteUrl()
    if (pledges.length > MAX_BULK_RECIPIENTS) {
      await tellAdminsSendAbandoned(d, campaign, '리워드 발송', pledges.length)
      return
    }

    const memberIds = pledges
      .map(p => p.user_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    const settings =
      memberIds.length > 0
        ? await d.getUserSettingsByUserIds(memberIds).catch(() => new Map<string, SettingLike[]>())
        : new Map<string, SettingLike[]>()

    // 한 사람이 같은 프로젝트에 여러 건을 후원할 수 있다. 사람 단위로 묶어
    // **한 통만** 보내고, 나머지 건수는 문장이 센다 — 주소가 같으면 대량
    // 발송기가 어차피 한 통으로 합치므로, 합쳐질 것을 알고 문장을 만든다.
    const groups = new Map<string, { head: Record<string, unknown>; count: number }>()
    for (const p of pledges) {
      const key =
        typeof p.user_id === 'string' && p.user_id.length > 0
          ? `u:${p.user_id}`
          : `e:${String(p.backer_email ?? '').toLowerCase()}`
      const found = groups.get(key)
      if (found) found.count += 1
      else groups.set(key, { head: p, count: 1 })
    }
    const notices = [...groups.values()].map(g => ({
      pledge: g.head,
      notice: buildPledgeShippedNotice(g.head, campaign, siteUrl, g.count - 1),
    }))

    // 인앱 — 문장이 같은 회원끼리 묶어 배치 INSERT. 리워드 이름이 문장에
    // 들어 있으므로 서로 다른 문장을 한 배치에 넣으면 남의 리워드가 보인다.
    const byMessage = new Map<string, { notice: NoticeCopy; userIds: string[] }>()
    for (const { pledge, notice } of notices) {
      if (typeof pledge.user_id !== 'string' || pledge.user_id.length === 0) continue
      const entry = byMessage.get(notice.message)
      if (entry) entry.userIds.push(pledge.user_id)
      else byMessage.set(notice.message, { notice, userIds: [pledge.user_id] })
    }
    for (const { notice, userIds } of byMessage.values()) {
      try {
        await d.createBulkNotifications({
          user_ids: [...new Set(userIds)],
          type: 'funding_shipped',
          title: notice.title,
          message: notice.message,
          data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
          expires_at: daysFromNow(180),
        })
      } catch (error) {
        d.log.error('리워드 발송 인앱 알림 실패', {
          campaignId: maskId(String(campaign.id)),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (!d.isMailConfigured()) return
    const result = await sendManyEmails({
      recipients: notices.map(({ pledge, notice }) => {
        const { subject, html } = renderNoticeEmail(notice)
        return { email: pledge.backer_email, user_id: pledge.user_id, subject, html }
      }),
      sendEmail: d.sendEmail,
      isOptedOut: id => isEmailOptedOut(settings.get(id)),
      log: d.log,
    })
    d.log.info('리워드 발송 알림 발송', { campaignId: maskId(String(campaign.id)), ...result })
  } catch (error) {
    d.log.error('리워드 발송 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ⑨ 정산 정리

/**
 * 정산 내역을 정리했다 → **개설자**.
 *
 * 마감 뒤 사무국이 결제대행 수수료를 넣어 정산서를 만든 그때 한 번. 정리한
 * 뒤 환불이 들어와 **지급 예정 금액이 달라졌을 때**만 `revised`로 다시 한 번.
 * 같은 금액을 두 번 알리지 않는다 — 같은 돈 이야기를 두 번 듣는 것이 한 번
 * 듣는 것보다 나쁘다.
 *
 * **선택 알림** — 아직 돈이 움직이지 않았다. 인앱은 항상, 메일은 수신거부를
 * 존중한다.
 */
export async function notifySettlementPrepared(
  campaign: Record<string, unknown>,
  settlement: SettlementLike,
  options: { revised?: boolean; payoutAccountMissing?: boolean } = {},
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const notice = buildSettlementPreparedNotice(campaign, settlement, d.siteUrl(), options)
    await inApp(d, campaign.owner_user_id, 'funding_settled', notice)
    await mailOwnerIfAllowed(d, campaign.owner_user_id, notice)
  } catch (error) {
    d.log.error('정산 준비 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- ⑩ 정산 지급

/**
 * 정산금을 지급했다 → **개설자**.
 *
 * **거래성** — 자기 돈이 실제로 움직였다는 통지라 수신 설정을 보지 않는다.
 */
export async function notifySettlementPaid(
  campaign: Record<string, unknown>,
  settlement: SettlementLike,
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const notice = buildSettlementPaidNotice(campaign, settlement, d.siteUrl())
    await inApp(d, campaign.owner_user_id, 'funding_settled', notice)
    await mailOwnerAlways(d, campaign.owner_user_id, notice)
  } catch (error) {
    d.log.error('정산 지급 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ------------------------------------------------------- ⑪ 지급 뒤 환불 (개설자)

/**
 * 지급이 끝난 정산의 캠페인에서 사무국이 후원을 환불했다 → **개설자**.
 *
 * 사무국 환불 라우트는 이 경우 확인을 한 번 더 받지만, 그 확인은 **사무국
 * 화면 안에서만** 일어난다. 개설자에게는 아무 말도 가지 않아, 이미 받은
 * 정산금 중 일부를 되돌려 줘야 한다는 사실을 나중에 전화로 처음 듣게 된다.
 *
 * **거래성** — 자기가 이미 받은 돈에 대한 이야기라 수신 설정을 보지 않는다.
 */
export async function notifyRefundAfterPayout(
  campaign: Record<string, unknown> | null,
  pledge: Record<string, unknown>,
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  if (!campaign) return
  const d = resolve(overrides)
  try {
    const notice = buildRefundAfterPayoutNotice(campaign, pledge, d.siteUrl())
    await inApp(d, campaign.owner_user_id, 'funding_settled', notice)
    await mailOwnerAlways(d, campaign.owner_user_id, notice)
  } catch (error) {
    d.log.error('지급 뒤 환불 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------- 정체 선점 (크론)

/** 같은 공지를 다시 내지 않는 창. 크론은 10분마다 도니 이것이 없으면 하루 144번 온다. */
export const STUCK_HOLDS_NOTICE_WINDOW_MS = DAY_MS

/**
 * 하루가 지나도 풀리지 않는 결제 대기 선점을 관리자에게 알린다.
 *
 * 만료 스윕은 토스가 승인했는데 우리 confirm이 유실된 결제를 구하는 유일한
 * 장치라, 스윕이 못 푸는 행 속에는 "돈은 나갔는데 후원이 없는" 건이 섞여 있을 수
 * 있다. 어느 쪽인지는 사람이 토스 거래 내역을 보고 정한다. 로그로만 남기면
 * 아무도 보지 않으므로 인앱 + 메일로 보낸다.
 *
 * - **하루 한 번만.** 같은 종류의 공지를 최근에 냈으면 조용히 넘어간다 — 크론이
 *   10분마다 같은 것을 다시 발견하기 때문이다.
 * - 선택 알림이다(수신거부 존중). 사무국 업무 통지이지 누군가의 돈 영수가 아니다.
 * - 스스로 삼킨다. 크론이 알림 때문에 죽으면 안 된다.
 */
export async function notifyStuckHolds(
  input: { count: number; orderIds: string[] },
  overrides?: Partial<NotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    if (!(input.count > 0)) return
    const since = new Date(Date.now() - STUCK_HOLDS_NOTICE_WINDOW_MS)
    if (await d.hasRecentSystemNotice('funding_stuck_holds', since)) {
      d.log.info('정체 선점 공지를 하루 안에 이미 냈으므로 다시 내지 않음', { count: input.count })
      return
    }

    const admins = await d.listAdminRecipients()
    if (admins.length === 0) {
      d.log.warn('정체 선점 공지를 받을 관리자가 없음', { count: input.count })
      return
    }
    const notice = buildStuckHoldsNotice(input, d.siteUrl())

    try {
      await d.createBulkNotifications({
        user_ids: admins.map(a => a.id),
        type: 'system_notice',
        title: notice.title,
        message: notice.message,
        data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
        expires_at: daysFromNow(7),
      })
    } catch (error) {
      d.log.error('정체 선점 공지 일괄 생성 실패', {
        count: admins.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (!d.isMailConfigured()) return
    const settings = await d
      .getUserSettingsByUserIds(admins.map(a => a.id))
      .catch(() => new Map<string, SettingLike[]>())
    const { subject, html } = renderNoticeEmail(notice)
    const result = await sendManyEmails({
      recipients: admins.map(a => ({ email: a.email, user_id: a.id, subject, html })),
      sendEmail: d.sendEmail,
      isOptedOut: id => isEmailOptedOut(settings.get(id)),
      log: d.log,
    })
    d.log.info('정체 선점 공지 발송', { count: input.count, ...result })
  } catch (error) {
    d.log.error('정체 선점 공지 실패', {
      count: input.count,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
