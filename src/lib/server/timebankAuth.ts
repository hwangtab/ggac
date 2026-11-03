import { NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import type { ProfileLike } from '@/lib/server/authz'
import { loadParty } from '@/db/queries/timebankLedger'
import { getTimebankProfile } from '@/db/queries/timebankProfiles'
import {
  TIMEBANK_ACCESS_MESSAGES,
  classifyTimebankAccess,
  timebankRateLimitKey,
  type TimebankAccess,
  type TimebankAccessMode,
} from '@/lib/timebank/access'
import type { Party } from '@/lib/timebank/rules'
import {
  TIMEBANK_DEFAULTS,
  getTimebankSettings,
  type TimebankSettings,
} from '@/lib/timebank/settings'
import { ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

/**
 * 타임뱅크 조합원 라우트의 인가 헬퍼(스펙 §7.1·§7.2·§9.3·§9.4).
 *
 * 전부 **`requireActiveMember()`를 먼저 부른다**(승인·활성 아니면 401/403 그대로).
 * 그 위에 판정 표(`classifyTimebankAccess`, `src/lib/timebank/access.ts`)를 얹는다:
 *
 * | 헬퍼 | 꺼짐 | 미동의·구판 | 탈퇴 신청 중 |
 * | --- | --- | --- | --- |
 * | `requireTimebankReader` | 허용 | 허용 | 허용 |
 * | `requireTimebankPeer` | 허용 | 403 | 허용 |
 * | `requireTimebankAgreer` | 403 | 허용 | 403 |
 * | `requireTimebankParticipant` | 403 | 403 | 403 |
 *
 * 설정을 못 읽으면 기본값(전부 꺼짐)으로 떨어진다 — fail-closed.
 */

export type { TimebankAccess, TimebankAccessMode }
export { classifyTimebankAccess, timebankRateLimitKey, TIMEBANK_ACCESS_MESSAGES }

export type TimebankActor = {
  user: { id: string }
  /** 세션 판정용 좁은 프로필(관리자 여부 등). */
  profile: ProfileLike | null
  settings: TimebankSettings
  /** 판정 1의 재료. `requireTimebankReader`는 읽지 않으므로 null이다. */
  participant: Party | null
  /** 어느 판이든 동의한 적이 있다. `requireTimebankReader`는 false. */
  agreed: boolean
}

const log = createLogger('timebankAuth')

/** 한 시간 창. 타임뱅크 쓰기 레이트리밋은 전부 이 창을 쓴다. */
const HOUR_MS = 60 * 60 * 1000

/**
 * 사용자 키 레이트리밋 설정(계획 Task 7: 글쓰기 10/시간, 댓글 30/시간, 동의 5/시간,
 * 자원은 댓글과 같은 30/시간). 키는 `timebankRateLimitKey`로 세션 사용자 id를 센다.
 */
export const TIMEBANK_RATE_LIMITS = {
  listing: {
    name: 'timebank_listing',
    windowMs: HOUR_MS,
    maxRequests: 10,
    message: '글을 너무 자주 올리고 있습니다. 잠시 후 다시 시도해 주세요.',
  },
  comment: {
    name: 'timebank_comment',
    windowMs: HOUR_MS,
    maxRequests: 30,
    message: '댓글을 너무 자주 남기고 있습니다. 잠시 후 다시 시도해 주세요.',
  },
  volunteer: {
    name: 'timebank_volunteer',
    windowMs: HOUR_MS,
    maxRequests: 30,
    message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
  agree: {
    name: 'timebank_agree',
    windowMs: HOUR_MS,
    maxRequests: 5,
    message: '동의 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
  // 계획 Task 8: 기록 20/시간, 확인·거절·취소 60/시간, CSV 10/시간.
  record: {
    name: 'timebank_record',
    windowMs: HOUR_MS,
    maxRequests: 20,
    message: '기록을 너무 자주 남기고 있습니다. 잠시 후 다시 시도해 주세요.',
  },
  decide: {
    name: 'timebank_decide',
    windowMs: HOUR_MS,
    maxRequests: 60,
    message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
  csv: {
    name: 'timebank_csv',
    windowMs: HOUR_MS,
    maxRequests: 10,
    message: '내려받기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
  // 공개 집계는 월별 SUM 여러 개를 돈다 — 조회를 되풀이해 차이를 캐는 것도 막는다.
  stats: {
    name: 'timebank_stats',
    windowMs: HOUR_MS,
    maxRequests: 30,
    message: '집계 조회가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
} as const

/** 한 사람이 동시에 열어 둘 수 있는 제공·요청 글 수(계획 Task 7). */
export const MAX_OPEN_TIMEBANK_LISTINGS = 20

async function readSettings(): Promise<TimebankSettings> {
  try {
    return await getTimebankSettings()
  } catch (error) {
    log.error('타임뱅크 설정 조회 실패 — 꺼짐으로 처리', {
      error: (error as Error)?.message,
    })
    return { ...TIMEBANK_DEFAULTS }
  }
}

function denial(verdict: Exclude<TimebankAccess, 'ok'>): NextResponse {
  return ApiError.forbidden(TIMEBANK_ACCESS_MESSAGES[verdict]).toNextResponse()
}

async function requireTimebank(mode: TimebankAccessMode): Promise<TimebankActor | NextResponse> {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user, profile } = auth

  const settings = await readSettings()
  if (mode === 'read') {
    return { user: { id: user.id }, profile, settings, participant: null, agreed: false }
  }

  let participant: Party | null
  let agreed: boolean
  try {
    const [party, tbProfile] = await Promise.all([
      loadParty(user.id, settings.terms_version),
      getTimebankProfile(user.id),
    ])
    participant = party
    agreed = tbProfile?.agreed_at != null
  } catch (error) {
    log.error('타임뱅크 참여 상태 조회 실패', { error: (error as Error)?.message })
    return ApiError.internalServerError('타임뱅크 참여 상태를 확인할 수 없습니다.').toNextResponse()
  }

  const verdict = classifyTimebankAccess({ settings, party: participant, agreed, mode })
  if (verdict !== 'ok') return denial(verdict)
  return { user: { id: user.id }, profile, settings, participant, agreed }
}

/** 읽기(목록·상세·댓글·내 프로필). 승인·활성 조합원이면 꺼져 있어도 연다(§7.2). */
export async function requireTimebankReader(): Promise<TimebankActor | NextResponse> {
  return requireTimebank('read')
}

/** 참여자 명단·재능 디렉터리. 현재 판 동의자끼리만 본다(§7.1). 꺼져도 연다. */
export async function requireTimebankPeer(): Promise<TimebankActor | NextResponse> {
  return requireTimebank('peer')
}

/** 이용규칙 동의. 켜져 있고 탈퇴 신청 중이 아니어야 한다. */
export async function requireTimebankAgreer(): Promise<TimebankActor | NextResponse> {
  return requireTimebank('agree')
}

/** 쓰기. 켜짐 + 현재 판 동의 + 탈퇴 신청 중 아님(§5 판정 1, §9.3, §9.4). */
export async function requireTimebankParticipant(): Promise<TimebankActor | NextResponse> {
  return requireTimebank('write')
}

/**
 * `applyRouteRateLimit`에 넘길 설정. **인가를 통과한 뒤에** 부른다 — 세는 단위가
 * IP가 아니라 세션 사용자다(`timebankRateLimitKey`).
 */
export function timebankRateLimit(action: keyof typeof TIMEBANK_RATE_LIMITS, userId: string) {
  return {
    ...TIMEBANK_RATE_LIMITS[action],
    keyGenerator: () => timebankRateLimitKey(action, userId),
  }
}
