/**
 * 펀딩 알림의 **억제 판정** — 순수 함수만 모았다.
 *
 * ## 왜 필요한가
 *
 * 알림 두 자리가 **당사자가 마음대로 반복할 수 있는 동작**에 매달려 있다.
 *
 * - 심사 요청(`submit`)은 개설자가 누른다. `withdraw`와 짝이라 제출·철회를
 *   번갈아 누르면 관리자 전원에게 메일이 끝없이 나간다.
 * - 리워드 예상 전달월 변경은 개설자가 저장할 때마다 그 리워드를 후원한
 *   **전원**에게 메일이 나간다. 6월↔7월을 오가면 저장할 때마다 수백 통이다.
 *
 * 태우는 것이 펀딩 메일만이면 펀딩만 멈춘다. 그런데 Resend 한도는 **가입
 * 인증·비밀번호 재설정과 같은 통**이다 — 한도를 태우면 조합원이 로그인도
 * 가입도 못 한다. 그래서 이 판정은 펀딩 기능이 아니라 **사이트 전체를**
 * 지킨다.
 *
 * ## 무엇을 근거로 판정하는가 — 활동 기록
 *
 * "이미 알렸는가"를 알림 행(`notifications`)으로 세지 않는다. 두 가지가
 * 걸린다.
 *
 * 1. 전달 시기 변경의 인앱 행은 **회원 후원자에게만** 만들어진다. 비회원만
 *    후원한 리워드는 행이 하나도 없어 세는 근거가 사라진다 — 하필 그 리워드가
 *    상한 없이 메일을 뿜는다.
 * 2. 개설자는 **자기 알림을 지울 수 있다**(`deleteNotification`). 개설자 앞으로
 *    남긴 행을 근거로 삼으면 지우고 다시 누르면 그만이다.
 *
 * `user_activities`는 둘 다 해당하지 않는다 — 받는 사람이 누구든 남고, 당사자가
 * 지울 수 없고, 두 동작 모두 이미 기록되고 있다(`funding_campaign_submitted`,
 * `funding_reward_delivery_changed`). 새 표도, 마이그레이션도 필요 없다.
 *
 * **지금 이 동작의 기록은 제외하고 읽는다.** 라우트가 방금 남긴 행의 id를
 * 넘겨 주고(`excludeId`), 그래서 첫 제출이 "이미 알렸다"로 잘못 읽히지 않는다.
 *
 * ## 값을 보고 억제하지 않는 이유
 *
 * "이미 알린 달로 돌아가는 변경은 알리지 않는다"가 처음 떠오르는 규칙이고,
 * 실제로 되돌리기 공격을 정확히 끊는다. 쓰지 않았다 — **진짜로 두 번 밀리는
 * 경우를 침묵시키기 때문이다.** 6월→7월(알림) → 7월→6월(앞당김, 알림) →
 * 6월→7월(진짜 재지연)에서 마지막을 "이미 알린 값"으로 억제하면 후원자는
 * 6월로 알고 기다린다. **틀린 날짜를 믿게 만드는 억제**는 메일 몇 통보다
 * 나쁘다. 그래서 값이 아니라 **횟수와 간격**만 본다.
 */

/**
 * 이 알림을 어디까지 낼 것인가.
 *
 * - `send` 평소대로 — 인앱도 메일도.
 * - `in_app_only` 인앱 행은 만들고 **메일만** 보내지 않는다. 공유 자원은
 *   메일 한도뿐이고, 인앱 행은 값이 새로우면 읽는 쪽에 쓸모가 있다.
 * - `skip` 아무것도 하지 않는다.
 */
export type NoticeDecision = 'send' | 'in_app_only' | 'skip'

/** 세는 창. 활동 기록을 이 길이만큼 거슬러 읽는다. */
export const THROTTLE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 같은 캠페인의 심사 요청을 다시 알리기까지 기다리는 시간.
 *
 * 30분 안에 다시 들어온 제출은 **같은 말**이다 — 관리자 알림은 "이 프로젝트가
 * 심사를 기다린다"이고, 철회했다 다시 냈다고 해서 문장이 달라지지 않는다.
 * 직전 알림은 30일간 살아 있고 심사 목록에도 그대로 있으므로, 억제해도
 * 관리자가 모르는 일은 생기지 않는다.
 */
export const SUBMIT_COOLDOWN_MS = 30 * 60 * 1000

/**
 * 24시간 동안 메일까지 내보내는 심사 요청의 최대 건수(캠페인을 가리지 않고).
 *
 * 캠페인은 얼마든지 만들 수 있으므로 캠페인별 간격만으로는 막히지 않는다 —
 * 100개를 만들어 하나씩 제출하면 간격 규칙에 한 번도 걸리지 않는다. 조합의
 * 실제 제출은 한 주에 몇 건이라 12건이면 평소의 수십 배다. 넘긴 뒤에도
 * **인앱 알림은 그대로 만든다** — 관리자가 심사 목록을 여는 이유가 그것이다.
 */
export const SUBMIT_DAILY_LIMIT = 12

/**
 * 한 리워드의 전달 시기 변경을 24시간 안에 **메일로** 알리는 최대 횟수.
 *
 * 하루 한 번이다. 같은 리워드가 하루에 두 번 밀리는 일은 사실상 없고, 두 번째
 * 변경도 회원 후원자에게는 인앱으로 간다(아래 상한 전까지).
 */
export const DELIVERY_REWARD_MAIL_LIMIT = 1

/**
 * 한 리워드의 전달 시기 변경을 24시간 안에 알리는 최대 횟수(인앱 포함).
 *
 * 세 번을 넘겼다면 정상 운영이 아니다. 인앱 행도 만들지 않는다 — 리워드 하나에
 * 후원자가 수백이면 저장 한 번이 수백 행이고, 그것 자체가 표를 부풀리는
 * 수단이 된다.
 */
export const DELIVERY_REWARD_LIMIT = 3

/** 활동 기록 한 줄 중 이 판정이 보는 것만. */
export interface ThrottleLedgerEntry {
  created_at: string
  target_id?: string | null
  metadata?: Record<string, unknown> | null
}

function timeOf(entry: ThrottleLedgerEntry): number {
  const t = Date.parse(String(entry.created_at ?? ''))
  return Number.isFinite(t) ? t : 0
}

/**
 * 심사 요청 알림을 어디까지 낼 것인가.
 *
 * `entries`는 최근 `THROTTLE_WINDOW_MS` 안의 `funding_campaign_submitted`
 * 기록이며 **지금 이 제출은 빠져 있어야 한다**.
 */
export function decideCampaignSubmittedNotice(input: {
  campaignId: string
  entries: ThrottleLedgerEntry[]
  now?: number
}): NoticeDecision {
  const now = input.now ?? Date.now()
  const entries = Array.isArray(input.entries) ? input.entries : []

  const cooldownFrom = now - SUBMIT_COOLDOWN_MS
  const repeated = entries.some(
    e => String(e.target_id ?? '') === input.campaignId && timeOf(e) >= cooldownFrom
  )
  if (repeated) return 'skip'

  const windowFrom = now - THROTTLE_WINDOW_MS
  const recent = entries.filter(e => timeOf(e) >= windowFrom).length
  if (recent >= SUBMIT_DAILY_LIMIT) return 'in_app_only'

  return 'send'
}

/**
 * 활동 기록 한 줄이 손댄 리워드 id들. 라우트가
 * `metadata.changes = [{ reward_id, reward_title, from, to }, …]`로 남긴다.
 */
export function rewardIdsInEntry(entry: ThrottleLedgerEntry): string[] {
  const changes = (entry.metadata as Record<string, unknown> | null | undefined)?.changes
  if (!Array.isArray(changes)) return []
  return changes
    .map(c => (c as Record<string, unknown> | null)?.reward_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * 전달 시기 변경 알림을 어디까지 낼 것인가.
 *
 * `entries`는 최근 `THROTTLE_WINDOW_MS` 안의 이 캠페인
 * `funding_reward_delivery_changed` 기록이며 **지금 이 저장은 빠져 있어야
 * 한다**. 리워드마다 따로 센다 — 여러 리워드가 한꺼번에 밀리는 저장은
 * 정직한 한 번의 동작이고, 서로를 막으면 안 된다.
 */
export function decideDeliveryChangeNotice(input: {
  rewardId: string
  entries: ThrottleLedgerEntry[]
  now?: number
}): NoticeDecision {
  const now = input.now ?? Date.now()
  const entries = Array.isArray(input.entries) ? input.entries : []
  const windowFrom = now - THROTTLE_WINDOW_MS

  const count = entries.filter(
    e => timeOf(e) >= windowFrom && rewardIdsInEntry(e).includes(input.rewardId)
  ).length

  if (count >= DELIVERY_REWARD_LIMIT) return 'skip'
  if (count >= DELIVERY_REWARD_MAIL_LIMIT) return 'in_app_only'
  return 'send'
}
