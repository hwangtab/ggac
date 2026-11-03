import type { TimebankListingKind, TimebankListingStatus } from '@/constants/timebank'
import { apiErrorMessage } from '@/utils/apiErrorMessage'

type Translate = (key: string, values?: Record<string, string | number>) => string

/** 게시판 목록 한 쪽의 글 수. `GET /api/timebank/listings`의 `PAGE_SIZE`와 같다. */
export const TIMEBANK_PAGE_SIZE = 20

/** 예상 시간 선택지(분) — 30분 단위 30~480(`parseListingInput`과 같은 범위). */
export const TIMEBANK_ESTIMATE_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30)

export const TIMEBANK_STATUS_STYLES: Record<TimebankListingStatus, string> = {
  open: 'bg-green-100 text-green-800',
  closed: 'bg-gray-200 text-gray-600',
}

export const TIMEBANK_KIND_STYLES: Record<TimebankListingKind, string> = {
  offer: 'bg-primary-50 text-primary-700',
  request: 'bg-amber-50 text-amber-800',
  coop_task: 'bg-violet-50 text-violet-700',
}

/**
 * 분 → "N시간 M분"(로케일별). `timebank` 네임스페이스의 `duration.*`를 쓴다.
 * `null`은 "미정". `src/lib/timebank/format.ts`의 `formatMinutes`는 한국어 고정이라
 * 화면에서는 이것을 쓴다.
 */
export function formatTimebankMinutes(t: Translate, minutes: number | null): string {
  if (minutes === null || minutes === undefined) return t('duration.undecided')
  const abs = Math.abs(Math.trunc(minutes))
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  const sign = minutes < 0 ? '−' : ''
  if (hours === 0) return sign + t('duration.minutes', { minutes: rest })
  if (rest === 0) return sign + t('duration.hours', { hours })
  return sign + t('duration.hoursMinutes', { hours, minutes: rest })
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 지금의 KST 월 `'YYYY-MM'`(내역 월 필터·CSV 기본값). `src/lib/timebank/month.ts`와 같은 계산. */
export function currentKstMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7)
}

/** ISO 시각 → KST `'YYYY-MM-DD HH:mm'`. 비었거나 깨졌으면 `'—'`. 로케일과 무관한 형식이다. */
export function formatTimebankDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** ISO 시각 → KST `'YYYY-MM-DD'`. */
export function formatTimebankDate(iso: string | null | undefined): string {
  const full = formatTimebankDateTime(iso)
  return full === '—' ? full : full.slice(0, 10)
}

/** 30분 단위 시간 선택지(분). 회원 기록·조합 업무 지급은 30~480이다. */
export const TIMEBANK_MINUTE_OPTIONS = TIMEBANK_ESTIMATE_OPTIONS

/**
 * 한 모양으로 둔다 — 이 저장소는 `strict: false`라 `ok`로 유니온을 좁히지 못한다.
 * `ok`가 거짓이면 `data`는 비어 있고 `error`에 문구가 있다.
 */
export type TimebankFetchResult<T> = {
  ok: boolean
  status: number
  data: T
  message: string | null
  error: string
}

/**
 * 타임뱅크 API 호출. 응답 본문 `{ success, data, message }` / `{ success: false, error }`
 * (`@/utils/apiWrapper`)을 풀어 준다. 실패 문구는 서버가 준 것을 그대로 쓴다 — 원장
 * 거부 사유(하한·상한·이중 승인 등)는 서버 표(`describeLedgerError`)가 사람 말로 바꾼다.
 */
export async function timebankFetch<T>(
  url: string,
  init: RequestInit & { json?: unknown } = {},
  fallbackError = 'Request failed'
): Promise<TimebankFetchResult<T>> {
  const { json, ...rest } = init
  try {
    const response = await fetch(url, {
      ...rest,
      headers:
        json === undefined ? rest.headers : { 'Content-Type': 'application/json', ...rest.headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
      cache: 'no-store',
    })
    const body = (await response.json().catch(() => null)) as {
      success?: boolean
      data?: T
      message?: string
      error?: unknown
    } | null
    if (!response.ok || !body || body.success === false) {
      return {
        ok: false,
        status: response.status,
        data: undefined as T,
        message: null,
        error: apiErrorMessage(body, fallbackError),
      }
    }
    return {
      ok: true,
      status: response.status,
      data: body.data as T,
      message: body.message ?? null,
      error: '',
    }
  } catch {
    return { ok: false, status: 0, data: undefined as T, message: null, error: fallbackError }
  }
}
