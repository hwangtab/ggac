/**
 * 타임뱅크 허용값의 정본. DB CHECK는 `minutes > 0` 하나뿐이고, 나머지 허용값은
 * 전부 여기서 정한다(스펙 §3).
 *
 * `src/lib/timebank/*`와 `scripts/testing/*`가 plain
 * `node --experimental-strip-types --test`로 이 파일을 직접 import하므로
 * 이 파일은 아무것도 import하지 않는다.
 */

/** 원장 행의 종류(스펙 §3.1). */
export const TIMEBANK_KINDS = [
  'exchange',
  'market',
  'reversal',
  'signup_grant',
  'carryover',
  'coop_task',
  'redeem',
  'redeem_refund',
  'adjustment',
  'withdrawal_settlement',
] as const
export type TimebankKind = (typeof TIMEBANK_KINDS)[number]

/** 회원 ↔ 회원 이동. 조합원 확인 라우트가 받는 유일한 kind다. */
export const MEMBER_TO_MEMBER_KINDS = ['exchange', 'market', 'reversal'] as const
export type MemberToMemberKind = (typeof MEMBER_TO_MEMBER_KINDS)[number]

/** `reversal`이 되돌릴 수 있는 원 이동의 kind. */
export const REVERSIBLE_KINDS = ['exchange', 'market'] as const

export const TIMEBANK_STATUSES = ['pending', 'confirmed', 'rejected', 'canceled'] as const
export type TimebankStatus = (typeof TIMEBANK_STATUSES)[number]

export const TIMEBANK_CATEGORIES = [
  'lesson',
  'feedback',
  'production_help',
  'moving',
  'audience',
  'admin_help',
  'daily',
  'etc',
] as const
export type TimebankCategory = (typeof TIMEBANK_CATEGORIES)[number]

export const TIMEBANK_REF_TYPES = [
  'listing',
  'reservation',
  'reward_order',
  'market_listing',
  'dispute',
] as const
export type TimebankRefType = (typeof TIMEBANK_REF_TYPES)[number]

export const TIMEBANK_LISTING_KINDS = ['offer', 'request', 'coop_task'] as const
export type TimebankListingKind = (typeof TIMEBANK_LISTING_KINDS)[number]

/** 게시판 글의 상태(스펙 §3 `timebank_listings.status`). */
export const TIMEBANK_LISTING_STATUSES = ['open', 'closed'] as const
export type TimebankListingStatus = (typeof TIMEBANK_LISTING_STATUSES)[number]

/** 조합 계좌 센티널. 회원 id와 겹치지 않는다(FK 없음). */
export const COOP_ACCOUNT = 'coop'

/** 모든 시간 값의 단위(분). */
export const UNIT_MINUTES = 30
/** `exchange`·`coop_task` 한 건의 상한(분). 하한은 `UNIT_MINUTES`. */
export const EXCHANGE_MAX_MINUTES = 480
/** 장터·조합 서비스(1-B)의 잔액 하한. 정책상 바꾸지 않으므로 설정이 아니다. */
export const SERVICE_FLOOR_MINUTES = 0
/** 공연 교환권 1장 = 60분(1-B 이음매, 스펙 §13.1). */
export const VOUCHER_MINUTES = 60

/** 대기 상한(스펙 §5): 기록자당 열린 pending, 같은 상대에게 열린 pending. */
export const PENDING_LIMIT_PER_RECORDER = 10
export const PENDING_LIMIT_PER_PAIR = 3
/** 같은 상대에게서 `windowDays` 안에 거절 `count`회 → `blockDays` 동안 기록 불가. */
export const REJECTION_BLOCK = { count: 3, windowDays: 30, blockDays: 30 } as const
/** 이 일수를 넘긴 pending은 조율자 화면에 뜬다. */
export const STALE_PENDING_DAYS = 7
/** 참여 통계에서 이 인원 미만인 구간은 숨긴다. */
export const STATS_MIN_BUCKET = 3

/** 문자열 상한(입력 파서·화면이 함께 쓴다). 장터 상수와 같은 크기다. */
export const TIMEBANK_TITLE_MAX = 80
export const TIMEBANK_DESCRIPTION_MAX = 3000
export const TIMEBANK_COMMENT_MAX = 1000
export const TIMEBANK_PROFILE_TEXT_MAX = 1000
export const TIMEBANK_MEMO_MAX = 500

/**
 * 내역 채널(스펙 §8 "채널 필터") → kind 묶음. 모든 kind가 정확히 한 채널에 든다
 * (`timebankTransferRoute.test.mjs`가 고정한다).
 *
 * - `service`: 조합 서비스(교환권·교환소) 사용과 환불. 1-B에서 둘을 가를 때는
 *   kind가 아니라 `ref_type`(`reservation`·`reward_order`)으로 가른다.
 * - `signup`: 가입 크레딧과 재가입 승계.
 * - `adjustment`: 관리자 조정과 탈퇴 정산.
 */
export const TIMEBANK_CHANNELS = {
  exchange: ['exchange'],
  market: ['market'],
  coop_task: ['coop_task'],
  service: ['redeem', 'redeem_refund'],
  signup: ['signup_grant', 'carryover'],
  adjustment: ['adjustment', 'withdrawal_settlement'],
  reversal: ['reversal'],
} as const satisfies Record<string, readonly TimebankKind[]>
export type TimebankChannel = keyof typeof TIMEBANK_CHANNELS
