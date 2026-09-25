/**
 * 사무국이 손으로 바로잡은 일을 **후원자에게** 알린다.
 *
 * 세 가지다. ① 사무국이 대리 환불했다. ② 사무국이 발송 표시를 되돌렸다.
 * ③ 자동 환불 결과를 확인하지 못했다 — 이것만 **사무국에게** 간다.
 *
 * ## 왜 `./notify.ts`가 아니라 여기인가
 *
 * 그쪽의 환불 문안(`buildPledgeRefundedNotice`)은 "결제를 승인하는 사이에"로
 * 시작한다 — 승인 직후 확정하지 못해 자동으로 돌려준 경우의 문장이다. 사무국이
 * 며칠 뒤 손으로 돌려준 건에 그 문장을 붙이면 **사실과 다른 안내**가 나간다.
 * 발송 표시를 되돌린 건은 아예 짝이 되는 문안이 없다.
 *
 * 배선은 그대로 빌려 쓴다 — `renderNoticeEmail`·`sendManyEmails`·
 * `createNotification`은 전부 기존 것이고, 이 파일은 문장과 수신자만 정한다.
 *
 * ## 무엇이 거래성이고 무엇이 정정인가
 *
 * **환불은 영수다.** 자기 돈이 돌아온 사실이라 수신 설정과 무관하게 보낸다
 * (`notify.ts`의 같은 판단).
 *
 * **발송 표시 되돌리기는 정정이다.** 앞서 "리워드를 보냈습니다"를 받은
 * 사람에게만 간다 — 그 메일을 받은 적 없는 사람에게는 알릴 일이 없고, 알리면
 * 없던 일을 설명하는 꼴이 된다. 앞의 안내가 틀렸다는 사실은 수신 설정으로
 * 끌 수 있는 종류가 아니므로 이것도 수신거부를 보지 않는다.
 *
 * **이 파일의 함수는 절대 던지지 않는다.** 환불과 상태 되돌리기는 이미
 * 끝난 일이고, 알림 하나가 그 응답을 바꾸면 안 된다.
 */

import { createBulkNotifications, createNotification } from '../../db/queries/notifications.ts'
import { listAdminRecipients } from '../../db/queries/profiles.ts'
import { sendEmail } from '../mail/send.ts'
import { createLogger } from '../../utils/logger.ts'
import { getSiteUrl } from '../../utils/site.ts'

import {
  MAX_BULK_RECIPIENTS,
  formatWon,
  fundingUrls,
  isSendableEmail,
  renderNoticeEmail,
  sendManyEmails,
  type NoticeCopy,
} from './notifyContent.ts'
import { campaignAllowsSelfCancel } from './fulfillment.ts'

const log = createLogger('funding/notifyOfficeRemedy')

export interface OfficeRemedyNotifyDeps {
  createNotification: (input: Record<string, unknown>) => Promise<unknown>
  /** 반환값은 쓰지 않는다(실제 구현은 Resend 메시지 식별자를 돌려준다). */
  sendEmail: (mail: { to: string; subject: string; html: string }) => Promise<unknown>
  isMailConfigured: () => boolean
  siteUrl: () => string
  log: { warn: (m: string, meta?: unknown) => void; error: (m: string, meta?: unknown) => void }
  /** 대량 발송기에 넘기는 조절값. 테스트가 0으로 낮춘다. */
  bulkOptions?: { minIntervalMs?: number; retryDelayMs?: number }
  listAdminRecipients: () => Promise<{ id: string; email: string | null }[]>
  createBulkNotifications: (input: Record<string, unknown>) => Promise<unknown>
}

const realDeps: OfficeRemedyNotifyDeps = {
  createNotification: input => createNotification(input as never),
  sendEmail,
  isMailConfigured: () =>
    typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.length > 0,
  siteUrl: getSiteUrl,
  log,
  listAdminRecipients,
  createBulkNotifications: input => createBulkNotifications(input as never),
}

function resolve(overrides?: Partial<OfficeRemedyNotifyDeps>): OfficeRemedyNotifyDeps {
  return overrides ? { ...realDeps, ...overrides } : realDeps
}

function lookupHint(pledge: Record<string, unknown>): string {
  if (pledge.user_id) return ''
  const code = pledge.pledge_code
  if (typeof code !== 'string' || code.length === 0) return ''
  return ` 후원번호는 ${code}이며, 이 번호와 후원할 때 쓰신 이메일로 후원 내역을 확인할 수 있습니다.`
}

/** 사무국이 대리 환불했다 — 그 후원자에게. */
export function buildOfficeRefundedNotice(
  pledge: Record<string, unknown>,
  campaign: Record<string, unknown> | null,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = typeof campaign?.title === 'string' ? campaign.title : '프로젝트'
  return {
    title: '후원을 전액 환불했습니다',
    // **사유는 싣지 않는다.** 사무국이 적는 사유는 내부 기록이고, 후원자가
    // 알아야 하는 것은 돈이 언제 어떻게 돌아오는가다. 사정 설명이 필요한
    // 건이면 사무국이 따로 연락한다.
    message: `'${title}' 후원을 사무국이 전액 환불 처리했습니다. 결제하신 ${formatWon(pledge.total_amount)}은 카드사에 따라 영업일 기준 3~5일 안에 확인하실 수 있습니다. 환불이 보이지 않으면 사무국(contact@ggac.kr)으로 후원자 성함과 결제하신 날짜를 알려 주세요.${lookupHint(pledge)}`,
    url: pledge.user_id ? urls.myPledges : urls.guestLookup,
    cta: pledge.user_id ? '내 후원 내역 보기' : '후원 내역 조회하기',
    data: {
      campaign_id: pledge.campaign_id ?? campaign?.id ?? null,
      pledge_code: pledge.pledge_code ?? null,
      refunded_by: 'office',
      scope: 'funding',
    },
  }
}

/** 사무국이 발송 표시를 되돌렸다 — 앞서 발송 안내를 받은 후원자에게. */
export function buildFulfillmentReversedNotice(
  pledge: Record<string, unknown>,
  campaign: Record<string, unknown> | null,
  siteUrl: string,
  /**
   * 되돌리면서 **이행 쪽 빗장**이 풀렸는가(`reopensSelfCancel`). 이것만으로
   * 후원자가 직접 취소할 수 있게 되는 것은 아니다 — 캠페인이 `active`가
   * 아니면 취소 라우트가 여전히 닫혀 있다.
   */
  selfCancelReopened: boolean
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = typeof campaign?.title === 'string' ? campaign.title : '프로젝트'
  // 마감된 캠페인에서 "직접 취소하실 수 있습니다"라고 말하면, 후원자는 취소
  // 버튼이 없는 화면에 도착한다. 그 경우에는 스스로 할 수 없다는 사실과
  // 대신 어디로 말하면 되는지를 함께 적는다.
  const selfCancelOpen = selfCancelReopened && campaignAllowsSelfCancel(campaign?.status)
  const tail = selfCancelOpen
    ? ' 후원 내역 화면에서 직접 전액 취소하실 수 있습니다.'
    : selfCancelReopened
      ? ' 이 프로젝트는 모금이 끝나 후원 내역 화면에서 직접 취소하실 수는 없습니다. 취소를 원하시면 아래 사무국 주소로 후원번호와 함께 알려 주세요 — 확인해 전액 환불해 드립니다.'
      : ' 리워드 준비 상황은 후원 내역 화면에서 확인하실 수 있습니다.'
  return {
    title: '리워드 발송 안내를 정정합니다',
    message: `'${title}'의 리워드가 아직 발송되지 않은 것으로 확인되어, 사무국이 발송 표시를 되돌렸습니다. 앞서 받으신 발송 안내는 취소해 주세요.${tail} 궁금한 점은 사무국(contact@ggac.kr)으로 후원번호와 함께 알려 주세요.${lookupHint(pledge)}`,
    url: pledge.user_id ? urls.myPledges : urls.guestLookup,
    cta: pledge.user_id ? '내 후원 내역 보기' : '후원 내역 조회하기',
    data: {
      campaign_id: pledge.campaign_id ?? campaign?.id ?? null,
      pledge_code: pledge.pledge_code ?? null,
      scope: 'funding',
    },
  }
}

async function inApp(
  d: OfficeRemedyNotifyDeps,
  userId: unknown,
  type: string,
  notice: NoticeCopy
): Promise<void> {
  if (typeof userId !== 'string' || userId.length === 0) return
  try {
    await d.createNotification({
      user_id: userId,
      type,
      title: notice.title,
      message: notice.message,
      action_url: notice.url ?? null,
      data: notice.data ?? {},
    })
  } catch (error) {
    d.log.error('인앱 알림 실패', { error: error instanceof Error ? error.message : String(error) })
  }
}

/** ① 사무국 대리 환불. 영수라 수신 설정을 보지 않는다. */
export async function notifyOfficeRefunded(
  pledge: Record<string, unknown>,
  campaign: Record<string, unknown> | null,
  overrides?: Partial<OfficeRemedyNotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const notice = buildOfficeRefundedNotice(pledge, campaign, d.siteUrl())
    await inApp(d, pledge.user_id, 'funding_refunded', notice)
    if (!isSendableEmail(pledge.backer_email)) return
    if (d.isMailConfigured() === false) {
      d.log.warn('RESEND_API_KEY가 없어 사무국 환불 메일을 건너뜀')
      return
    }
    const { subject, html } = renderNoticeEmail(notice)
    await d.sendEmail({ to: pledge.backer_email as string, subject, html })
  } catch (error) {
    d.log.error('사무국 환불 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * ② 발송 표시 되돌리기. 호출부는 **경계를 거꾸로 넘은 건만** 넘긴다
 * (`crossesSentBoundaryBackward`) — 그 사람들만 앞서 발송 안내를 받았다.
 *
 * 인앱 알림은 `funding_shipped`를 그대로 쓴다. 발송에 대한 같은 갈래의
 * 소식이고, 목록의 이름표도 하나면 된다 — 종류를 하나 늘리면 스키마·타입·
 * 이름표·이동 규칙 네 곳을 손으로 맞춰야 한다.
 */
export async function notifyFulfillmentReversed(
  campaign: Record<string, unknown> | null,
  pledges: { pledge: Record<string, unknown>; selfCancelReopened: boolean }[],
  overrides?: Partial<OfficeRemedyNotifyDeps>
): Promise<void> {
  if (!Array.isArray(pledges) || pledges.length === 0) return
  const d = resolve(overrides)
  try {
    const siteUrl = d.siteUrl()
    if (pledges.length > MAX_BULK_RECIPIENTS) {
      d.log.error('되돌리기 알림 수신자가 상한을 넘어 발송하지 않음', { count: pledges.length })
      return
    }
    const recipients = []
    for (const { pledge, selfCancelReopened } of pledges) {
      const notice = buildFulfillmentReversedNotice(pledge, campaign, siteUrl, selfCancelReopened)
      await inApp(d, pledge.user_id, 'funding_shipped', notice)
      const { subject, html } = renderNoticeEmail(notice)
      recipients.push({ email: pledge.backer_email, user_id: pledge.user_id, subject, html })
    }
    if (d.isMailConfigured() === false) {
      d.log.warn('RESEND_API_KEY가 없어 되돌리기 메일을 건너뜀', { count: recipients.length })
      return
    }
    // 수신거부를 보지 않는다 — 앞의 안내가 틀렸다는 사실은 끌 수 있는
    // 종류가 아니다(파일 머리 주석 참고).
    const result = await sendManyEmails({
      recipients,
      sendEmail: d.sendEmail,
      log: d.log,
      minIntervalMs: d.bulkOptions?.minIntervalMs,
      retryDelayMs: d.bulkOptions?.retryDelayMs,
    })
    if (result.failed > 0 || result.capped) {
      d.log.error('되돌리기 알림 일부 실패', {
        failed: result.failed,
        capped: result.capped,
        sent: result.sent,
      })
    }
  } catch (error) {
    d.log.error('되돌리기 알림 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * ③ 승인 뒤 자동 환불의 **결과를 확인하지 못했다** — 사무국에게.
 *
 * 이 경우 후원은 `canceled`가 되고 결제 행에 실패 사유 한 줄이 남는다. 그
 * 문장은 아무도 찾아 읽지 않는 자리에 있어서, "돈을 받은 적 없는 후원"과
 * 구분되지 않은 채 목록에 섞인다. 실제로는 **승인은 났고 환불이 나갔는지
 * 모르는** 건이라, 사람이 토스 거래 내역을 열어 봐야만 결말이 난다.
 *
 * 그래서 후원자 쪽 안내(그쪽은 라우트가 이미 문장으로 말해 준다)와 별개로
 * 사무국을 부른다. 수신거부를 보지 않는다 — 후원자의 돈이 어디 있는지 모르는
 * 상태이고, 그것은 끌 수 있는 종류의 통지가 아니다.
 *
 * 이 파일의 다른 함수들과 같이 **절대 던지지 않는다.**
 */
export function buildOfficeRefundUncertainNotice(
  input: { orderId: string; pledgeId: string; campaignTitle: string | null },
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = input.campaignTitle ?? '프로젝트'
  return {
    title: '자동 환불 결과를 확인하지 못한 후원이 있습니다',
    message:
      `'${title}'에서 결제는 승인됐으나 후원을 확정할 자리가 없어 전액 환불을 요청했고, ` +
      `그 결과를 확인하지 못했습니다. 이미 환불됐을 수도 있고 돈이 그대로 남아 있을 수도 있습니다. ` +
      `토스 거래 내역에서 주문번호를 확인해 환불이 나가지 않았으면 콘솔에서 취소해 주세요. ` +
      `주문번호: ${input.orderId} / 후원 ID: ${input.pledgeId}`,
    url: urls.adminReview,
    cta: '관리자 화면으로',
    data: {
      kind: 'funding_refund_uncertain',
      order_id: input.orderId,
      pledge_id: input.pledgeId,
      scope: 'funding',
    },
  }
}

export async function notifyOfficeRefundUncertain(
  input: { orderId: string; pledgeId: string; campaignTitle: string | null },
  overrides?: Partial<OfficeRemedyNotifyDeps>
): Promise<void> {
  const d = resolve(overrides)
  try {
    const admins = await d.listAdminRecipients()
    if (admins.length === 0) {
      d.log.warn('자동 환불 불확실 공지를 받을 관리자가 없음', { orderId: input.orderId })
      return
    }
    const notice = buildOfficeRefundUncertainNotice(input, d.siteUrl())
    try {
      await d.createBulkNotifications({
        user_ids: admins.map(a => a.id),
        type: 'system_notice',
        title: notice.title,
        message: notice.message,
        data: notice.url ? { ...notice.data, url: notice.url } : notice.data,
      })
    } catch (error) {
      d.log.error('자동 환불 불확실 인앱 공지 실패', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (d.isMailConfigured() === false) {
      d.log.warn('RESEND_API_KEY가 없어 자동 환불 불확실 메일을 건너뜀', {
        orderId: input.orderId,
      })
      return
    }
    const { subject, html } = renderNoticeEmail(notice)
    const result = await sendManyEmails({
      recipients: admins.map(a => ({ email: a.email, user_id: a.id, subject, html })),
      sendEmail: d.sendEmail,
      log: d.log,
      minIntervalMs: d.bulkOptions?.minIntervalMs,
      retryDelayMs: d.bulkOptions?.retryDelayMs,
    })
    if (result.failed > 0) {
      d.log.error('자동 환불 불확실 공지 일부 실패', { failed: result.failed, sent: result.sent })
    }
  } catch (error) {
    d.log.error('자동 환불 불확실 공지 실패', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
