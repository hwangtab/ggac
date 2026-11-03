/**
 * 입력 중인 글(임시 저장) — 기기별 localStorage. 여러 기기 동기화는 하지 않는다(범위 밖).
 * 키 `kw-draft:<userId>:<channelId>[:<parentId>]`, 값 JSON `{ v: 저장 형식 본문(멘션 토큰 포함), t: 저장 시각(ms), u: userId }`.
 * 같은 브라우저를 여러 사람이 쓸 수 있어 사용자별로 키를 나누고, 로그아웃 때 `kw-draft:` 접두 키를 모두 지운다.
 * 사용자 구분이 없던 옛 키(`kw-draft:<channelId>[:<parentId>]`)는 읽지 않고 정리한다(값에 u 가 없으면 옛 것).
 * localStorage 는 시크릿 창·차단·용량 초과에서 던질 수 있으므로 모든 접근을 try/catch 로 감싸고,
 * 실패하면 조용히 "저장 안 함"으로 넘어간다(입력 자체는 막지 않는다).
 * 첨부 대기 목록은 저장하지 않는다 — 글만.
 */

export const DRAFT_PREFIX = 'kw-draft:'
/** 이보다 오래된 임시 저장은 정리한다 */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 같은 탭의 다른 컴포넌트(사이드바)에 변경을 알리는 이벤트 */
export const DRAFT_EVENT = 'kw-draft-change'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY_RE = new RegExp(`^${DRAFT_PREFIX}(${UUID}):(${UUID})(?::(${UUID}))?$`, 'i')

export function draftKey(userId: string, channelId: string, parentId?: string | null): string {
  const base = `${DRAFT_PREFIX}${userId}:${channelId}`
  return parentId ? `${base}:${parentId}` : base
}

/** 키 → { userId, channelId, parentId }. 형식이 아니면 null */
export function parseDraftKey(
  key: string
): { userId: string; channelId: string; parentId: string | null } | null {
  const m = KEY_RE.exec(key)
  return m
    ? {
        userId: m[1].toLowerCase(),
        channelId: m[2].toLowerCase(),
        parentId: m[3]?.toLowerCase() ?? null,
      }
    : null
}

/** 로그아웃 때 이 브라우저의 임시 저장·이어 올리기 기록을 모두 지운다(다음 사람에게 남지 않게) */
export function clearUserLocalData(): void {
  const s = storage()
  if (!s) return
  try {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && (k.startsWith(DRAFT_PREFIX) || k.startsWith('kw-tus-resume:'))) keys.push(k)
    }
    for (const k of keys) s.removeItem(k)
  } catch {
    // 지우지 못해도 로그아웃은 계속한다
  }
  notify()
}

/** 키의 사용자 칸(첫 구간). 구간이 둘 미만이면(옛 키) null */
function keyOwner(key: string): string | null {
  if (!key.startsWith(DRAFT_PREFIX)) return null
  const parts = key.slice(DRAFT_PREFIX.length).split(':')
  return parts.length >= 2 && parts[0] ? parts[0].toLowerCase() : null
}

/** 키의 사용자 칸과 값의 u 가 같은 것만 유효하다(옛 키·남의 값은 무효) */
function ownedValue(key: string, parsed: unknown): boolean {
  const u = (parsed as { u?: unknown } | null)?.u
  const owner = keyOwner(key)
  return typeof u === 'string' && owner !== null && u.toLowerCase() === owner
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function notify() {
  try {
    window.dispatchEvent(new Event(DRAFT_EVENT))
  } catch {
    // 이벤트를 못 보내도 저장은 유효하다
  }
}

/** 저장된 글. 없거나 7일이 지났거나 깨졌으면 null(지난 것은 지운다) */
export function loadDraft(key: string, now: number = Date.now()): string | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const v = (parsed as { v?: unknown } | null)?.v
    const t = (parsed as { t?: unknown } | null)?.t
    if (
      typeof v !== 'string' ||
      typeof t !== 'number' ||
      now - t > DRAFT_MAX_AGE_MS ||
      !ownedValue(key, parsed)
    ) {
      s.removeItem(key)
      return null
    }
    return v.trim() ? v : null
  } catch {
    return null
  }
}

// 로그아웃 정리가 kw-draft 를 지운 뒤 입력창이 사라지며(언마운트·visibilitychange) 다시 저장하는 것을 막는다.
// 모듈 수준 플래그라 SPA 이동으로는 풀리지 않는다 — 다음 로그인의 앱 셸이 마운트될 때 `resumeDraftWrites()`.
let draftWritesSuspended = false

/** 로그아웃 정리 시작 때 켠다: 이후 `saveDraft` 는 아무것도 쓰지 않는다 */
export function suspendDraftWrites(): void {
  draftWritesSuspended = true
}

/** 다시 로그인한 앱 셸이 마운트되면 임시 저장을 재개한다(테스트도 쓴다) */
export function resumeDraftWrites(): void {
  draftWritesSuspended = false
}

export function isDraftWritesSuspended(): boolean {
  return draftWritesSuspended
}

/** 저장된 글의 값·저장 시각(지우지 않고 읽기만 — 다른 탭의 최신 저장 판단용). 없거나 깨졌으면 null */
export function readDraftStamp(key: string): { v: string; t: number } | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const v = (parsed as { v?: unknown } | null)?.v
    const t = (parsed as { t?: unknown } | null)?.t
    if (typeof v !== 'string' || typeof t !== 'number' || !ownedValue(key, parsed)) return null
    return { v, t }
  } catch {
    return null
  }
}

/** 이 탭이 마지막으로 읽었거나 저장한 상태 — 값(text)과 그 저장 시각(t, 없으면 0) */
export type DraftSync = { text: string; t: number }

/**
 * 이 탭에서 값이 바뀌었을 때만(dirty) 저장하고, 다른 탭이 더 새로 저장해 뒀으면 덮지 않는다.
 * 같은 대화를 두 탭에서 열었을 때 한쪽이 숨겨지며(visibilitychange) 무조건 저장해 다른 탭의 최신 글을
 * 지우거나 덮는 일을 막는다. 새 동기 상태를 돌려준다(저장하지 않았으면 그대로).
 */
export function persistDraft(
  key: string,
  text: string,
  sync: DraftSync,
  now: number = Date.now()
): DraftSync {
  if (draftWritesSuspended) return sync
  if (text === sync.text) return sync
  const stored = readDraftStamp(key)
  if (stored && stored.t > sync.t && stored.v !== text) return sync
  saveDraft(key, text, now)
  return { text, t: now }
}

/** 저장. 비어 있으면(공백뿐 포함) 삭제한다 */
export function saveDraft(key: string, text: string, now: number = Date.now()): void {
  if (draftWritesSuspended) return
  const s = storage()
  if (!s) return
  try {
    if (!text.trim()) {
      if (s.getItem(key) !== null) {
        s.removeItem(key)
        notify()
      }
      return
    }
    const had = s.getItem(key) !== null
    s.setItem(key, JSON.stringify({ v: text, t: now, u: keyOwner(key) ?? undefined }))
    if (!had) notify()
  } catch {
    // 용량 초과·차단 — 임시 저장만 포기한다
  }
}

export function removeDraft(key: string): void {
  const s = storage()
  if (!s) return
  try {
    if (s.getItem(key) !== null) {
      s.removeItem(key)
      notify()
    }
  } catch {
    // 무시
  }
}

/** 7일 지난·깨진·옛 형식 임시 저장 정리. 지운 개수를 돌려준다 */
export function pruneDrafts(now: number = Date.now()): number {
  const s = storage()
  if (!s) return 0
  let removed = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      let stale = true
      try {
        const parsed: unknown = JSON.parse(s.getItem(k) ?? 'null')
        const t = (parsed as { t?: unknown } | null)?.t
        stale = typeof t !== 'number' || now - t > DRAFT_MAX_AGE_MS || !ownedValue(k, parsed)
      } catch {
        stale = true
      }
      if (stale) {
        s.removeItem(k)
        removed++
      }
    }
  } catch {
    // 무시
  }
  if (removed > 0) notify()
  return removed
}

/** 임시 저장이 있는 대화(채널) id 집합 — 스레드 임시 저장도 그 채널로 센다 */
export function draftChannelIds(userId: string, now: number = Date.now()): Set<string> {
  const out = new Set<string>()
  const s = storage()
  if (!s) return out
  try {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      const parsed = parseDraftKey(k)
      if (parsed && parsed.userId === userId.toLowerCase() && loadDraft(k, now) !== null) {
        out.add(parsed.channelId)
      }
    }
  } catch {
    // 무시
  }
  return out
}
