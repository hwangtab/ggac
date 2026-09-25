/**
 * 비회원 선점에 **회선(IP) 단위 상한**을 하나 더 세운다.
 *
 * ## 왜 이메일만으로는 모자란가
 *
 * 선점 트랜잭션의 상한(`MAX_HOLDS_PER_REWARD`·`MAX_OUTSTANDING_HOLDS`)은
 * "같은 사람"을 회원은 계정으로, 비회원은 **이메일**로 본다
 * (`ownHoldCondition`). 계정은 가입과 승인을 거쳐야 하나 더 생기지만,
 * 이메일은 요청자가 한 글자만 바꿔 얼마든지 새로 댈 수 있다. 그래서 비회원
 * 쪽 상한은 시도마다 신원을 갈아 끼우는 요청 앞에서 **아무것도 세지 못한다** —
 * 돈 한 푼 내지 않고 리워드 재고를 선점으로 비울 수 있다.
 *
 * 선점이 10분 만에 스스로 풀리는 것과 라우트의 빈도 제한이 그동안의 방어선
 * 이었는데, 뒤쪽은 프로젝트를 가리지 않고 한 창에 200건이라 **한 프로젝트의
 * 재고를 비우는 데에는 넉넉한** 값이다(그 값의 목적은 폭주 완충이지 재고
 * 방어가 아니라고 그 자리에 적혀 있다).
 *
 * ## 무엇으로 세는가
 *
 * 요청자가 시도마다 고를 수 없는 것 — **접속 회선**이다. 이메일 대신이 아니라
 * 이메일과 **함께** 선다: 이메일 상한은 한 사람이 재고를 쥔 채 결제를 미루는
 * 것을 막고(그쪽이 본래 하던 일), 이 상한은 그 이메일을 갈아 끼우는 것을
 * 막는다.
 *
 * **회원에게는 걸지 않는다.** 회원 선점은 계정으로 세므로 신원 회전이 애초에
 * 값싸지 않고, 여기에 IP를 걸면 한 회선 뒤의 조합원들(사무실·행사장 와이파이,
 * 이동통신 CGNAT)이 서로의 상한을 갉아먹는다.
 *
 * ## 값을 왜 이렇게 잡았나
 *
 * 세는 창은 **선점 한 벌이 살아 있는 시간**(`hold_minutes`, 기본 10분)이다 —
 * 그 창을 넘긴 선점은 이미 스스로 풀려 재고로 돌아가 있으므로, 더 긴 창으로
 * 세면 풀린 선점까지 상한에 얹는 셈이 된다.
 *
 * 상한 20은 **프로젝트별**이고, 비회원 한 사람이 정당하게 만들 수 있는 최대
 * 선점 수(`MAX_OUTSTANDING_HOLDS` = 5)의 네 배다. 한 회선 뒤에서 같은
 * 프로젝트를 동시에 후원하는 비회원 네 명이 저마다 자기 상한 끝까지 고쳐
 * 골라도 걸리지 않고, 한 사람이 한두 번씩 누르는 평범한 경우로 치면 10분에
 * 열댓 명이다. 공격자 쪽에서 보면 회선 하나로 열 수 있는 선점이 200에서
 * 20으로 줄어든다.
 *
 * ⚠ 이 상한은 분산 카운터(Upstash)가 설정돼 있어야 실제로 선다. 없으면
 * 인스턴스별 메모리로 떨어져 Vercel에서는 사실상 세지 않는다 — 그건 이
 * 저장소의 모든 빈도 제한이 공유하는 조건이고 `CLAUDE.md`에 적혀 있다.
 */

/** 한 회선이 한 프로젝트에 같은 창 안에서 만들 수 있는 비회원 선점 수. */
export const GUEST_HOLDS_PER_IP_PER_CAMPAIGN = 20

/** 설정값이 이상할 때 쓰는 창(분). `getFundingSettings`의 기본값과 같다. */
const FALLBACK_HOLD_MINUTES = 10

export interface GuestHoldCap {
  name: string
  windowMs: number
  maxRequests: number
  message: string
  /**
   * IP 열쇠 뒤에 붙일 조각. **프로젝트별로 센다** — 전체로 세면 프로젝트 셋을
   * 견주어 보던 회선이 네 번째에서 막힌다.
   */
  keySuffix: string
}

/**
 * 이 요청에 회선 상한을 걸어야 하는가. 걸어야 하면 그 설정, 아니면 `null`.
 *
 * 요청도 DB도 모른다 — 넘겨받은 세 값만 본다.
 */
export function planGuestHoldCap(input: {
  /** 로그인한 조합원이면 그 계정, 비회원이면 `null`. */
  userId: string | null
  campaignId: string
  /** 선점이 살아 있는 시간(분). 세는 창이 된다. */
  holdMinutes: number
}): GuestHoldCap | null {
  if (typeof input.userId === 'string' && input.userId.length > 0) return null

  const minutes =
    Number.isFinite(input.holdMinutes) && input.holdMinutes > 0
      ? Math.min(Math.floor(input.holdMinutes), 60)
      : FALLBACK_HOLD_MINUTES

  return {
    name: 'funding_prepare_guest_holds',
    windowMs: minutes * 60_000,
    maxRequests: GUEST_HOLDS_PER_IP_PER_CAMPAIGN,
    // 막힌 사람이 할 수 있는 일을 적는다. 이 자리에서 막히는 대다수는
    // 공격자가 아니라 한 회선을 나눠 쓰는 후원자다.
    message: `같은 인터넷 회선에서 이 프로젝트의 후원 요청이 한꺼번에 몰려 잠시 접수를 멈췄습니다. ${minutes}분 뒤에 다시 후원해 주세요. 계속 막히면 휴대전화 데이터로 바꿔 접속하시거나, 로그인한 뒤 후원하시면 바로 진행됩니다. 사무국(contact@ggac.kr)으로 알려 주셔도 도와드리겠습니다.`,
    keySuffix: input.campaignId.length > 0 ? input.campaignId : 'unknown',
  }
}
