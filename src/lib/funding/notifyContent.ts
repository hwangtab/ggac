/**
 * 펀딩 알림의 **문안과 수신자 판정** — 순수 함수만 모았다.
 *
 * DB·메일·환경변수를 건드리지 않는다. 배선은 `./notify.ts`가 한다. 이렇게
 * 가르는 이유는 `src/lib/server/grantPublish.ts`와 같다 — "익명 후원자의
 * 이름이 개설자에게 새지 않는가", "비회원(user_id 없음)에게도 문장이
 * 만들어지는가" 같은 조건을 네트워크 없이 못박아야 하기 때문이다.
 *
 * 로컬 import는 `.ts`를 명시한다 — `node --test`의 타입 스트리핑 모드 제약.
 *
 * 용어는 고정이다: 펀딩 / 후원 / 후원자 / 후원하기. 구매·주문·상품·기부는
 * 쓰지 않는다(약관과 화면이 쓰는 말과 같아야 한다).
 */

import { PAYOUT_ACCOUNT_SETTINGS_PATH } from './payoutAccount.ts'
import { cooperativeLossFor } from './settlement.ts'

export interface NoticeCopy {
  /** 인앱 알림 제목이자 메일 제목. */
  title: string
  /** 인앱 알림 본문. 메일 본문의 첫 문단과 같은 내용이다. */
  message: string
  /** 갈 곳. 없으면 null. */
  url: string | null
  /** 링크 버튼에 적을 말. `url`이 있을 때만 쓴다. */
  cta: string | null
  /** 인앱 알림 `data` 컬럼에 실을 값. 개인정보는 담지 않는다. */
  data: Record<string, unknown>
}

// ---------------------------------------------------------------- 공통 도구

/** 원 단위 정수를 `50,000원`으로. */
export function formatWon(amount: unknown): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0원'
  return `${new Intl.NumberFormat('ko-KR').format(Math.round(n))}원`
}

/**
 * 앞말의 받침을 보고 조사를 고른다.
 *
 * 문장 안에 값을 끼워 넣는 자리마다 필요하다 — `2026년 6월`은 `로`를 받고
 * `미정`은 `으로`를 받는다. 하나로 고정해 두면 **모든 달에 대해 틀린다**
 * (첫 배선에서 `으로`로 박아 두었다가 이 검토에서 잡혔다).
 *
 * 한글이 아닌 글자로 끝나면(영문·숫자·기호) 판정하지 않고 받침 있는 쪽을
 * 돌려준다 — 읽는 방식이 사람마다 달라 맞히려 들면 더 어색해진다. 그런
 * 자리에는 애초에 조사를 붙이지 않는 것이 낫다.
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.at(-1) ?? ''
  const code = last.charCodeAt(0)
  if (!(code >= 0xac00 && code <= 0xd7a3)) return withFinal
  const finalIndex = (code - 0xac00) % 28
  // 받침 ㄹ(8)은 '로'·'으로'에서 받침 없는 쪽과 같이 움직인다. 호출부가
  // `로`/`으로`를 넘길 때만 의미가 있으므로 그 조합에서만 예외를 둔다.
  if (finalIndex === 0) return withoutFinal
  if (finalIndex === 8 && withoutFinal === '로') return withoutFinal
  return withFinal
}

/** `…{값}으로` / `…{값}로`를 받침에 맞게. */
export function ro(word: string): string {
  return `${word}${josa(word, '으로', '로')}`
}

/** `YYYY-MM` → `2026년 3월`. 형식이 다르면 받은 값을 그대로 돌려준다. */
export function formatDeliveryMonth(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '미정'
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  if (!m) return value
  return `${m[1]}년 ${Number(m[2])}월`
}

/** 보낼 수 있는 주소인가. 공백·형식 오류는 건너뛴다 — 주소를 추측해서 고치지 않는다. */
export function isSendableEmail(email: unknown): email is string {
  if (typeof email !== 'string' || email.length === 0) return false
  if (email.trim() !== email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** 로그에 주소를 통째로 남기지 않는다. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 1) return '***'
  return `${email.slice(0, 2)}***${email.slice(at)}`
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

// ---------------------------------------------------------------- 링크

export interface FundingUrls {
  campaign: (slug: unknown) => string | null
  /** 개설자 대시보드(내 프로젝트 한 건). */
  creatorCampaign: (id: unknown) => string | null
  /** 관리자 심사 목록. 한국어 전용 화면이다. */
  adminReview: string
  /** 조합원 본인의 후원 내역. */
  myPledges: string
  /** 비회원 후원 조회. */
  guestLookup: string
}

/**
 * 링크는 전부 여기서 만든다 — 도메인을 문안 안에 박아 넣지 않는다.
 * `siteUrl`은 호출부가 `getSiteUrl()`로 구해 넘긴다.
 */
export function fundingUrls(siteUrl: string): FundingUrls {
  const base = siteUrl.replace(/\/$/, '')
  return {
    campaign: slug => (typeof slug === 'string' && slug ? `${base}/ko/funding/${slug}` : null),
    creatorCampaign: id =>
      typeof id === 'string' && id ? `${base}/ko/mypage/funding/${id}` : null,
    adminReview: `${base}/ko/admin/funding`,
    myPledges: `${base}/ko/mypage/funding`,
    guestLookup: `${base}/ko/funding/manage`,
  }
}

// ---------------------------------------------------------------- 메일 렌더

const EMAIL_STYLE =
  'font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",sans-serif;font-size:15px;line-height:1.7;color:#1f2937;'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 알림 하나를 메일 본문으로 만든다. 인앱과 같은 문장을 쓰고, 링크가 있으면
 * 버튼 하나를 붙인다. 표·이미지는 쓰지 않는다 — 문장이 곧 내용이다.
 */
export function renderNoticeEmail(
  notice: NoticeCopy,
  extraLines: string[] = []
): { subject: string; html: string } {
  const lines = [notice.message, ...extraLines].filter(l => typeof l === 'string' && l.length > 0)
  const body = lines.map(l => `<p style="margin:0 0 12px;">${escapeHtml(l)}</p>`).join('')
  const link = notice.url
    ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(notice.url)}" style="color:#111827;font-weight:600;">${escapeHtml(notice.cta ?? '바로 가기')}</a></p>`
    : ''
  return {
    subject: `[경기아트콜렉티브] ${notice.title}`,
    html: `<div style="${EMAIL_STYLE}"><h2 style="font-size:18px;margin:0 0 16px;">${escapeHtml(notice.title)}</h2>${body}${link}<p style="margin:28px 0 0;font-size:13px;color:#6b7280;">경기아트콜렉티브 협동조합 · 문의 contact@ggac.kr</p></div>`,
  }
}

// ---------------------------------------------------------------- 후원자 이름

/**
 * 개설자·사무국에게 보여도 되는 후원자 표기.
 *
 * **익명을 고른 후원자의 이름은 여기서 막힌다.** 공개 명단
 * (`listPublicBackers`)과 같은 규칙이다 — 한쪽만 고치면 다시 샌다.
 */
export function backerDisplayName(pledge: Record<string, unknown>): string {
  if (pledge.is_anonymous === true) return '익명'
  return str(pledge.backer_name, '후원자')
}

/**
 * 비회원을 후원 조회 화면으로 보내는 문장에 **후원번호를 함께 준다.**
 *
 * 그 화면은 후원번호와 이메일 두 가지가 맞아야 열린다. 비회원은 인앱 알림이
 * 없어 번호를 찾아볼 곳이 이 메일 말고는 없다 — 번호 없이 "조회해 보라"고
 * 하면 갈 수 없는 곳을 가리키는 셈이다. 회원은 마이페이지로 가므로 붙이지
 * 않는다.
 */
function lookupHint(pledge: Record<string, unknown>): string {
  if (pledge.user_id) return ''
  const code = str(pledge.pledge_code)
  if (!code) return ''
  return ` 후원번호는 ${code}이며, 이 번호와 후원할 때 쓰신 이메일로 후원 내역을 확인할 수 있습니다.`
}

// ---------------------------------------------------------------- 문안 5+2종

/** ① 심사 요청이 들어왔다 — 사무국(관리자)에게. */
export function buildCampaignSubmittedNotice(
  campaign: Record<string, unknown>,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = str(campaign.title, '제목 없는 프로젝트')
  return {
    title: '펀딩 심사 요청이 들어왔습니다',
    message: `'${title}' 프로젝트가 심사를 기다리고 있습니다. 관리자 화면에서 내용을 확인하고 승인하거나 사유를 적어 돌려보낼 수 있습니다.`,
    url: urls.adminReview,
    cta: '심사하러 가기',
    data: { campaign_id: campaign.id ?? null, scope: 'funding' },
  }
}

/** ② 승인·반려 — 개설자에게. 반려 사유를 문장 안으로 가져온다. */
export function buildCampaignReviewedNotice(
  campaign: Record<string, unknown>,
  action: 'approve' | 'reject',
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = str(campaign.title, '제목 없는 프로젝트')
  if (action === 'approve') {
    return {
      title: '펀딩 프로젝트가 승인되었습니다',
      message: `'${title}' 프로젝트가 승인되어 공개되었습니다. 이제 후원을 받을 수 있습니다.`,
      url: urls.campaign(campaign.slug) ?? urls.creatorCampaign(campaign.id),
      cta: '프로젝트 보기',
      data: { campaign_id: campaign.id ?? null, action, scope: 'funding' },
    }
  }
  // 반려 사유가 없으면 "사유 없이 돌려보냈다"고 적지 않는다 — 개설자가 다음에
  // 할 일(사무국에 묻기)을 문장이 알려 준다.
  const note = str(campaign.review_note)
  const reason = note
    ? `돌려보낸 사유는 다음과 같습니다. ${note}`
    : '돌려보낸 사유가 적혀 있지 않습니다. 사무국(contact@ggac.kr)으로 문의해 주세요.'
  return {
    title: '펀딩 프로젝트가 반려되었습니다',
    message: `'${title}' 프로젝트가 심사를 통과하지 못했습니다. ${reason}`,
    url: urls.creatorCampaign(campaign.id),
    cta: '내용 고치러 가기',
    data: { campaign_id: campaign.id ?? null, action, scope: 'funding' },
  }
}

/** ③-1 결제가 끝났다 — 후원자에게. 영수 성격이라 수신 설정과 무관하게 나간다. */
export function buildPledgePaidBackerNotice(
  pledge: Record<string, unknown>,
  campaign: Record<string, unknown> | null,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const campaignTitle = str(campaign?.title, str(pledge.campaign_title, '프로젝트'))
  // 회원이면 마이페이지, 비회원이면 후원번호로 여는 조회 화면. 비회원에게
  // 마이페이지를 주면 로그인 벽을 만난다.
  const url = pledge.user_id ? urls.myPledges : urls.guestLookup
  return {
    title: '후원이 완료되었습니다',
    message: `'${campaignTitle}' 후원이 정상적으로 접수되었습니다. 결제 금액은 ${formatWon(pledge.total_amount)}입니다. 후원번호는 ${str(pledge.pledge_code, '-')}입니다.`,
    url,
    cta: pledge.user_id ? '내 후원 내역 보기' : '후원 내역 조회하기',
    data: {
      campaign_id: pledge.campaign_id ?? null,
      pledge_code: pledge.pledge_code ?? null,
      scope: 'funding',
    },
  }
}

/** 후원자 메일에만 덧붙이는 줄. 리워드와 조회 방법. */
export function pledgePaidBackerExtraLines(pledge: Record<string, unknown>): string[] {
  const lines = [`리워드: ${str(pledge.reward_title, '-')} ${Number(pledge.quantity) || 1}개`]
  if (typeof pledge.credit_name === 'string' && pledge.credit_name.trim() !== '') {
    lines.push(
      `기재할 이름: ${pledge.credit_name.trim()} — 틀렸다면 펀딩이 끝나기 전에 사무국(contact@ggac.kr)으로 알려 주세요.`
    )
  }
  if (!pledge.user_id) {
    lines.push('후원번호와 후원할 때 쓰신 이메일로 후원 내역을 확인하고 취소할 수 있습니다.')
  }
  return lines
}

/**
 * ③-2 후원이 들어왔다 — 개설자에게.
 *
 * **후원자의 이메일·연락처·주소는 담지 않는다.** 개설자가 배송지를 볼 곳은
 * 후원자 목록 화면이지 알림이 아니다. 익명 후원은 이름 대신 '익명'이 간다.
 */
export function buildPledgePaidCreatorNotice(
  pledge: Record<string, unknown>,
  campaign: Record<string, unknown> | null,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const campaignTitle = str(campaign?.title, '프로젝트')
  return {
    title: '새 후원이 들어왔습니다',
    message: `'${campaignTitle}'에 ${backerDisplayName(pledge)}님이 ${formatWon(pledge.total_amount)}을 후원했습니다. 리워드는 ${str(pledge.reward_title, '-')}입니다.`,
    url: urls.creatorCampaign(pledge.campaign_id ?? campaign?.id),
    cta: '후원자 목록 보기',
    data: { campaign_id: pledge.campaign_id ?? null, scope: 'funding' },
  }
}

/** ④ 마감 — 개설자에게. */
export function buildCampaignClosedNotice(
  campaign: Record<string, unknown>,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = str(campaign.title, '제목 없는 프로젝트')
  return {
    title: '펀딩 프로젝트가 마감되었습니다',
    message: `'${title}' 프로젝트의 후원 접수가 끝났습니다. 후원자 목록과 배송 정보를 확인하고 리워드 전달을 준비해 주세요. 사무국이 결제대행 수수료를 확인해 정산 내역을 정리하면 지급 예정 금액이 이 화면에 표시되고, 지급이 끝나면 따로 알려 드립니다. 궁금한 점은 사무국(contact@ggac.kr)으로 문의해 주세요.`,
    url: urls.creatorCampaign(campaign.id),
    cta: '후원자 목록 보기',
    data: { campaign_id: campaign.id ?? null, scope: 'funding' },
  }
}

export interface DeliveryChangeLike {
  reward_id: string
  reward_title: string
  from: string | null
  to: string | null
}

/** ⑤ 예상 전달월이 바뀌었다 — 그 리워드를 후원한 사람에게(약관 제12조). */
export function buildDeliveryChangedNotice(
  change: DeliveryChangeLike,
  campaign: Record<string, unknown>,
  pledge: Record<string, unknown>,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const campaignTitle = str(campaign.title, '프로젝트')
  return {
    title: '리워드 전달 예정 시기가 바뀌었습니다',
    message: `'${campaignTitle}'의 '${change.reward_title}' 리워드 전달 예정 시기가 ${formatDeliveryMonth(change.from)}에서 ${ro(formatDeliveryMonth(change.to))} 바뀌었습니다.${lookupHint(pledge)}`,
    url: pledge.user_id ? urls.myPledges : urls.guestLookup,
    cta: pledge.user_id ? '내 후원 내역 보기' : '후원 내역 조회하기',
    data: {
      campaign_id: campaign.id ?? null,
      reward_id: change.reward_id,
      scope: 'funding',
    },
  }
}

/** ⑥ 승인된 결제를 환불했다 — 후원자에게. 돈 이야기라 수신 설정과 무관하다. */
export function buildPledgeRefundedNotice(
  pledge: Record<string, unknown>,
  reason: 'reward_sold_out' | 'campaign_closed',
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const what =
    reason === 'campaign_closed'
      ? '결제를 승인하는 사이에 프로젝트가 마감되어'
      : '결제를 승인하는 사이에 마지막 남은 수량이 다른 후원자에게 돌아가'
  return {
    title: '후원을 확정하지 못해 전액 환불했습니다',
    message: `${what} 후원을 확정하지 못했습니다. 결제하신 ${formatWon(pledge.total_amount)}은 전액 환불했으며, 카드사에 따라 영업일 기준 3~5일 안에 확인하실 수 있습니다. 환불이 보이지 않으면 사무국(contact@ggac.kr)으로 후원자 성함과 결제하신 날짜를 알려 주세요. 확인해 드리겠습니다. 불편을 드려 죄송합니다.${lookupHint(pledge)}`,
    url: pledge.user_id ? urls.myPledges : urls.guestLookup,
    cta: pledge.user_id ? '내 후원 내역 보기' : '후원 내역 조회하기',
    data: {
      campaign_id: pledge.campaign_id ?? null,
      pledge_code: pledge.pledge_code ?? null,
      reason,
      scope: 'funding',
    },
  }
}

/**
 * ⑧ 리워드를 보냈다 → **그 후원의 후원자**.
 *
 * 개설자가 이행 상태를 `shipped`(또는 건너뛴 `delivered`)로 옮긴 건에만
 * 나간다. `preparing`은 개설자의 내부 단계라 알리지 않고, 이미 보냈다고 알린
 * 건을 `delivered`로 마저 옮길 때도 다시 알리지 않는다 — 같은 소포를 두 번
 * 알리는 것이 한 번도 안 알리는 것보다 나쁘다.
 *
 * **선택 알림** — 돈이 오가는 일이 아니라 배송 소식이므로 수신거부를
 * 존중한다(전달 시기 변경과 같은 갈래다). 비회원은 설정 자체가 없어 그대로
 * 받고, 인앱 알림이 없으므로 문장이 후원번호를 함께 들고 간다.
 *
 * **남의 정보는 담지 않는다** — 프로젝트 이름과 이 사람 자신의 리워드뿐이다.
 * 송장 번호를 적는 칸은 이 시스템에 없으므로 문장도 약속하지 않는다.
 */
export function buildPledgeShippedNotice(
  pledge: Record<string, unknown>,
  campaign: Record<string, unknown> | null,
  siteUrl: string,
  /**
   * 같은 사람이 이번에 함께 받는 **다른** 후원 건수. 한 사람이 같은
   * 프로젝트에 여러 건을 후원할 수 있고(선물 세 건은 이 조합에서 예외가
   * 아니다), 메일은 주소당 한 통만 나가므로 나머지를 문장이 세어 준다.
   */
  otherCount = 0
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const campaignTitle = str(campaign?.title, '프로젝트')
  const what =
    otherCount > 0
      ? `리워드 '${str(pledge.reward_title, '-')}' 외 ${otherCount}건`
      : `리워드 '${str(pledge.reward_title, '-')}'`
  return {
    title: '리워드를 보냈습니다',
    message: `'${campaignTitle}'의 ${what}를 발송했습니다. 도착까지 보통 2~3일이 걸리며, 받으신 뒤 문제가 있으면 사무국(contact@ggac.kr)으로 알려 주세요.${lookupHint(pledge)}`,
    url: pledge.user_id ? urls.myPledges : urls.guestLookup,
    cta: pledge.user_id ? '내 후원 내역 보기' : '후원 내역 조회하기',
    data: {
      campaign_id: campaign?.id ?? pledge.campaign_id ?? null,
      pledge_code: pledge.pledge_code ?? null,
      scope: 'funding',
    },
  }
}

/**
 * ⑦ 후원자가 상한을 넘어 자동 발송을 포기했다 → **관리자**.
 *
 * 알려야 할 사람에게 아무것도 못 보냈다는 사실을, 손으로 보낼 수 있는 사람이
 * 알아야 한다. 런타임 로그는 이 조합에서 아무도 보지 않는 곳이다.
 */
export function buildBulkAbandonedNotice(
  campaign: Record<string, unknown>,
  what: string,
  recipientCount: number,
  limit: number,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  return {
    title: '펀딩 알림을 자동으로 보내지 못했습니다',
    message: `'${str(campaign.title, '프로젝트')}'의 ${what} 알림을 받을 사람이 ${recipientCount}명으로 한 번에 보낼 수 있는 ${limit}명을 넘어 자동 발송을 하지 않았습니다. 후원자 목록을 내려받아 사무국에서 직접 알려 주세요.`,
    url: urls.creatorCampaign(campaign.id),
    cta: '프로젝트 보기',
    data: { campaign_id: campaign.id ?? null, recipient_count: recipientCount, scope: 'funding' },
  }
}

/**
 * 정산 내역 한 건이 문장으로 들고 다니는 값. DB 컬럼과 키가 같다.
 */
export interface SettlementLike {
  gross_amount: unknown
  refund_amount: unknown
  pg_fee_amount: unknown
  platform_fee_amount: unknown
  payout_amount: unknown
}

/**
 * 셈을 문장 하나로 편다.
 *
 * 화면에서든 메일에서든 **읽는 사람이 뺄셈을 따라올 수 있어야 한다.** 총
 * 모금액에서 무엇을 뺐는지 적지 않고 결론만 주면, 액수가 기대와 다를 때
 * 창작자가 할 수 있는 일이 "사무국에 묻기"밖에 없다.
 *
 * `원`은 언제나 받침으로 끝나므로 조사를 고정해도 안전하다(`josa` 불필요).
 */
function settlementArithmetic(settlement: SettlementLike): string {
  const gross = Number(settlement.gross_amount) || 0
  const refund = Number(settlement.refund_amount) || 0
  return `총 모금액 ${formatWon(gross)}에서 환불 ${formatWon(refund)}을 뺀 실 모금액이 ${formatWon(gross - refund)}이고, 여기서 결제대행 수수료 ${formatWon(settlement.pg_fee_amount)}과 플랫폼 수수료 ${formatWon(settlement.platform_fee_amount)}을 뺀 금액입니다.`
}

/**
 * 수수료가 실 모금액보다 클 때의 차액 — 조합이 떠안은 돈. 0이면 빈 문자열이다.
 *
 * 후원이 전부 환불된 캠페인에서 생긴다. 결제대행사는 환불해도 제 수수료를
 * 대체로 돌려주지 않는다. 그 사실을 문장에서 빼면 창작자는 수수료 줄과 0원
 * 지급을 나란히 보고 자기가 물어내야 하는 돈인지 헷갈린다.
 */
function settlementLossLine(settlement: SettlementLike): string {
  const loss = cooperativeLossFor(settlement as Parameters<typeof cooperativeLossFor>[0])
  if (loss <= 0) return ''
  return ` 실 모금액보다 수수료가 ${formatWon(loss)} 많은데, 이 차액은 조합이 부담하며 창작자에게 청구하지 않습니다.`
}

/**
 * ⑨ 정산 내역을 정리했다 → **개설자**.
 *
 * 마감 뒤 사무국이 결제대행 수수료를 확인해 정산서를 만든 그때 한 번 나간다.
 * 정리한 뒤 환불이 들어와 **지급 예정 금액이 달라졌을 때**만 다시 나간다
 * (`revised`) — 같은 금액을 두 번 알리지 않는다.
 *
 * **선택 알림** — 아직 돈이 움직이지 않았고, 인앱과 대시보드에 그대로 남는다.
 *
 * 계좌를 등록하지 않은 개설자에게는 **그 사실과 고치러 갈 자리**를 함께
 * 보낸다(`payoutAccountMissing`). 지급 전이 이 말을 할 수 있는 마지막
 * 순간이고, 이때 말하지 않으면 사무국이 전화로 물어보는 수밖에 없다.
 * 계좌 **값**은 어느 알림에도 싣지 않는다 — 여기서 하는 말은 "비어 있다"뿐이다.
 */
export function buildSettlementPreparedNotice(
  campaign: Record<string, unknown>,
  settlement: SettlementLike,
  siteUrl: string,
  options: { revised?: boolean; payoutAccountMissing?: boolean } = {}
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = str(campaign.title, '제목 없는 프로젝트')
  const payout = formatWon(settlement.payout_amount)
  const accountLine =
    options.payoutAccountMissing === true
      ? ` 정산금을 보낼 계좌가 등록되어 있지 않습니다. 마이페이지 > 내 정보(${siteUrl.replace(/\/$/, '')}${PAYOUT_ACCOUNT_SETTINGS_PATH})에서 은행·계좌번호·예금주를 등록해 주세요.`
      : ''
  if (options.revised === true) {
    return {
      title: '정산 예정 금액이 바뀌었습니다',
      message: `'${title}' 프로젝트의 정산 내역을 다시 정리했습니다. 후원 환불이 반영되어 지급 예정 금액이 ${payout}으로 바뀌었습니다. ${settlementArithmetic(settlement)}${accountLine} 지급이 끝나면 다시 알려 드립니다.`,
      url: urls.creatorCampaign(campaign.id),
      cta: '정산 내역 보기',
      data: { campaign_id: campaign.id ?? null, revised: true, scope: 'funding' },
    }
  }
  return {
    title: '정산 내역이 정리되었습니다',
    message: `'${title}' 프로젝트의 정산 내역을 정리했습니다. 지급 예정 금액은 ${payout}입니다. ${settlementArithmetic(settlement)}${settlementLossLine(settlement)}${accountLine} 지급이 끝나면 다시 알려 드립니다. 내역이 실제와 다르면 지급 전에 사무국(contact@ggac.kr)으로 알려 주세요.`,
    url: urls.creatorCampaign(campaign.id),
    cta: '정산 내역 보기',
    data: { campaign_id: campaign.id ?? null, revised: false, scope: 'funding' },
  }
}

/**
 * ⑩ 정산금을 지급했다 → **개설자**.
 *
 * 조합이 실제로 돈을 보냈다는 통지다. **거래성** — 자기 돈에 대한 통지라
 * 수신 설정을 보지 않는다(후원 완료·환불 통지와 같은 갈래다). 개설자는 언제나
 * 회원이므로 인앱 알림도 함께 남는다.
 *
 * 지급액이 0원인 정산도 있다(실 모금액이 수수료 합과 같은 경우). 그때도
 * 보낸다 — 받을 돈이 없다는 것도 알아야 하는 사실이고, 아무 말 없이 끝나면
 * 기다리기만 한다.
 */
export function buildSettlementPaidNotice(
  campaign: Record<string, unknown>,
  settlement: SettlementLike,
  siteUrl: string
): NoticeCopy {
  const urls = fundingUrls(siteUrl)
  const title = str(campaign.title, '제목 없는 프로젝트')
  const payout = Number(settlement.payout_amount) || 0
  const net = (Number(settlement.gross_amount) || 0) - (Number(settlement.refund_amount) || 0)
  // **계좌를 "등록된 계좌"라고 부르지 않는다.** 프로필에 은행·계좌 칸이 있기는
  // 하지만 둘 다 비어 있을 수 있고, 이 흐름은 그 값을 읽지도 요구하지도
  // 않는다. 한 번도 채운 적 없는 창작자에게 "등록된 계좌로 보냈다"고 하면
  // 없는 계좌를 찾게 만든다. 사무국이 아는 계좌로 보냈다는 것만 말하고,
  // 그것이 틀렸을 때 갈 곳을 함께 준다.
  const head =
    payout > 0
      ? `'${title}' 프로젝트의 정산금 ${formatWon(payout)}을 사무국이 알고 있는 계좌로 보냈습니다.`
      : net <= 0
        ? `'${title}' 프로젝트는 후원이 모두 환불되어 정산할 금액이 남지 않았습니다.`
        : `'${title}' 프로젝트의 정산을 마쳤습니다. 수수료를 빼고 나면 지급할 금액이 남지 않아 보내 드린 돈은 없습니다.`
  return {
    title: '정산금을 지급했습니다',
    message: `${head} ${settlementArithmetic(settlement)}${settlementLossLine(settlement)} 입금이 보이지 않거나 계좌가 바뀌었거나 내역이 실제와 다르면 사무국(contact@ggac.kr)으로 알려 주세요.`,
    url: urls.creatorCampaign(campaign.id),
    cta: '정산 내역 보기',
    data: { campaign_id: campaign.id ?? null, scope: 'funding' },
  }
}

// ---------------------------------------------------------------- 대량 발송

/**
 * 한 번에 메일을 보낼 수 있는 최대 인원.
 *
 * 리워드 하나의 후원자 수에 상한이 없다. 서버리스 함수에는 있다 — 한 통에
 * 0.3초만 잡아도 1,000명이면 5분이고, 그 함수는 도중에 끊긴다(그러면 앞쪽
 * 절반만 받고 누가 받았는지도 모른다). 상한을 넘으면 **보내지 않고 로그로
 * 남긴다** — 반쪽 발송보다 "안 나갔다"를 아는 편이 사무국이 손쓸 수 있다.
 */
export const MAX_BULK_RECIPIENTS = 400

/**
 * 발송 사이의 최소 간격(ms).
 *
 * Resend의 기본 한도는 **초당 2통**이다. 처음에는 5통을 동시에 띄웠는데 그건
 * 초당 열여섯 통쯤이라 429가 돌아오고, 429는 `sendEmail`이 던지는 실패로
 * 세어져 그 사람은 아무것도 못 받은 채 끝난다. 동시 발송을 없애고(아래
 * `BULK_CONCURRENCY = 1`) 시작 간격을 벌려 한도 안에 들어간다.
 *
 * `src/lib/server/grantPublish.ts`가 순차로 보내는 것과 같은 판단이다 —
 * 거기는 18통이라 간격조차 필요 없었고, 여기는 수백 통이라 간격이 필요하다.
 */
export const BULK_MIN_INTERVAL_MS = 500

/** 동시에 띄우는 발송 수. 한 통씩 보낸다 — 위 간격과 함께 한도를 지킨다. */
export const BULK_CONCURRENCY = 1

/** 429를 만났을 때 한 번 더 기다렸다 해 본다. */
export const RATE_LIMIT_RETRY_DELAY_MS = 1200

/**
 * 레이트리밋(429) 때문에 실패했는가. `sendEmail`은 상태 코드를 메시지에 담아
 * 던진다(`Resend 발송 실패 (429): …`) — 우리가 만드는 문장이라 형태가 고정이다.
 */
export function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('(429)') || /\b429\b/.test(message)
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export interface BulkSendResult {
  sent: number
  failed: number
  /** 주소가 없거나 형식이 깨졌다. */
  skipped_address: number
  /** 이 회원이 이메일 수신을 껐다. */
  skipped_optout: number
  /** 상한을 넘어 아무것도 보내지 않았다. */
  capped: boolean
  /** 429를 만나 한 번 더 시도했고 그때 성공한 건수. `sent`에도 포함된다. */
  retried: number
  /** 실패한 주소(마스킹)와 사유. */
  errors: { to: string; error: string }[]
}

export interface BulkRecipient {
  email: unknown
  /** 수신거부 판정에 쓴다. 비회원은 null. */
  user_id?: unknown
  /** 이 사람에게 보낼 내용. */
  subject: string
  html: string
}

/**
 * 여러 통을 보낸다. **한 통이 실패해도 나머지는 계속 나간다** — 루프 안에서
 * 던지면 첫 번째 잘못된 주소가 뒤의 전원을 막는다(`runGrantPublish`가 같은
 * 이유로 같은 모양이다). 의존성을 주입받아 네트워크 없이 검증한다.
 */
export async function sendManyEmails(input: {
  recipients: BulkRecipient[]
  sendEmail: (mail: { to: string; subject: string; html: string }) => Promise<void>
  /** 이 사용자가 이메일 수신을 껐는가. 영수 성격의 알림은 이 함수를 넘기지 않는다. */
  isOptedOut?: (userId: string) => boolean
  log?: { error: (msg: string, meta?: unknown) => void }
  limit?: number
  concurrency?: number
  /** 발송 시작 간격(ms). 테스트가 0으로 낮춘다. */
  minIntervalMs?: number
  /** 429 재시도 대기(ms). 테스트가 0으로 낮춘다. */
  retryDelayMs?: number
}): Promise<BulkSendResult> {
  const limit = input.limit ?? MAX_BULK_RECIPIENTS
  const result: BulkSendResult = {
    sent: 0,
    failed: 0,
    skipped_address: 0,
    skipped_optout: 0,
    capped: false,
    retried: 0,
    errors: [],
  }
  if (input.recipients.length > limit) {
    result.capped = true
    input.log?.error('펀딩 알림 수신자가 상한을 넘어 발송하지 않음', {
      count: input.recipients.length,
      limit,
    })
    return result
  }

  const queue: BulkRecipient[] = []
  // 같은 주소로 두 번 보내지 않는다 — 한 사람이 같은 리워드를 두 번 후원할 수 있다.
  const seen = new Set<string>()
  for (const r of input.recipients) {
    if (input.isOptedOut && typeof r.user_id === 'string' && input.isOptedOut(r.user_id)) {
      result.skipped_optout += 1
      continue
    }
    if (!isSendableEmail(r.email)) {
      result.skipped_address += 1
      continue
    }
    const key = r.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queue.push(r)
  }

  let cursor = 0
  const concurrency = Math.max(1, input.concurrency ?? BULK_CONCURRENCY)
  const minInterval = input.minIntervalMs ?? BULK_MIN_INTERVAL_MS
  const retryDelay = input.retryDelayMs ?? RATE_LIMIT_RETRY_DELAY_MS
  let nextSlotAt = 0

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= queue.length) return
      const r = queue[index]
      const to = r.email as string

      if (minInterval > 0) {
        const now = Date.now()
        const wait = Math.max(0, nextSlotAt - now)
        nextSlotAt = Math.max(now, nextSlotAt) + minInterval
        if (wait > 0) await sleep(wait)
      }

      try {
        await input.sendEmail({ to, subject: r.subject, html: r.html })
        result.sent += 1
      } catch (error) {
        // 429는 "지금은 안 된다"이지 "이 주소는 못 쓴다"가 아니다. 한 번은 더
        // 해 본다 — 여기서 포기하면 그 사람만 영영 아무것도 못 받는다.
        if (isRateLimited(error)) {
          if (retryDelay > 0) await sleep(retryDelay)
          try {
            await input.sendEmail({ to, subject: r.subject, html: r.html })
            result.sent += 1
            result.retried += 1
            continue
          } catch (retryError) {
            recordFailure(result, input.log, to, retryError)
            continue
          }
        }
        recordFailure(result, input.log, to, error)
      }
    }
  })
  await Promise.all(workers)
  return result
}

function recordFailure(
  result: BulkSendResult,
  log: { error: (msg: string, meta?: unknown) => void } | undefined,
  to: string,
  error: unknown
): void {
  result.failed += 1
  const message = error instanceof Error ? error.message : String(error)
  result.errors.push({ to: maskEmail(to), error: message.slice(0, 200) })
  log?.error('펀딩 알림 메일 발송 실패', { to: maskEmail(to), error: message })
}
