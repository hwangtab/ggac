/**
 * 메시지 앵커 `#msg-<uuid>` (검색 결과 링크 `/c/<slug>#msg-<id>`, `/dm/<id>#msg-<id>`).
 * MessageItem 이 타임라인에서 `id="msg-<id>"` 를 단다.
 */
const ANCHOR_RE = /^#?msg-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export function messageAnchor(messageId: string): string {
  return `msg-${messageId}`
}

/** location.hash → 메시지 id. 형식이 아니면 null */
export function messageIdFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null
  let raw = hash
  try {
    raw = decodeURIComponent(hash)
  } catch {
    // 잘못된 % 인코딩 — 원문 그대로 검사
  }
  const m = ANCHOR_RE.exec(raw.trim())
  return m ? m[1].toLowerCase() : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 메시지로 가는 링크. 채널은 /c/<slug>, DM(또는 slug 없음)은 /dm/<channelId>, 앵커 #msg-<id>.
 * 스레드 답글이면 `?thread=<parentId>` 를 붙여 채널 화면이 그 스레드 패널을 열고 답글을 강조한다(QA #2).
 */
export function messageLink(opts: {
  channelId: string
  kind: string | null | undefined
  slug: string | null | undefined
  messageId: string
  parentId?: string | null
}): string {
  // ggac 이식: 업무툴 경로는 /board-room 아래다(channel-items.ts WORK_BASE_PATH와 같은 값)
  const base =
    !opts.kind || opts.kind === 'dm' || !opts.slug
      ? `/board-room/dm/${opts.channelId}`
      : `/board-room/c/${encodeURIComponent(opts.slug)}`
  const thread = opts.parentId ? `?thread=${opts.parentId}` : ''
  return `${base}${thread}#${messageAnchor(opts.messageId)}`
}

/** 페이지 searchParams 의 thread 값 → 스레드 부모 id(uuid 가 아니면 null) */
export function threadIdFromSearch(raw: string | string[] | undefined): string | null {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return v && UUID_RE.test(v) ? v.toLowerCase() : null
}
