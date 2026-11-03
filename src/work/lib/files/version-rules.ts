import { formatDateTime } from '@work/lib/format/datetime'
import { escapeMarkdownInline } from '@work/lib/tabs/schema'

/**
 * 문서 버전 규칙(순수, docs/09 §2·§3·§4). 서버 액션과 화면이 같은 판정을 쓴다 — 실제 차단은 서버 액션이 한다.
 * 'use server' 파일(version-actions)은 async 함수만 export 할 수 있어 타입·순수 함수를 여기 둔다.
 */

/** "수정 중" 표시 유효 시간(시간). 만료는 조회 시 거른다(크론 없음) */
export const CHECKOUT_HOURS = 8

/** 버전 기록 패널·목록에 보이는 계보의 한 버전 */
export type FileVersionItem = {
  id: string
  versionNo: number
  name: string
  mime: string
  size: number
  createdAt: string
  uploaderName: string | null
  /** 이 버전이 달린 게시물이 삭제됨 */
  deleted: boolean
  isLatest: boolean
  isFinal: boolean
}

export type FileCheckout = {
  userId: string
  userName: string | null
  /** 가져간 시각 */
  since: string
  until: string
  mine: boolean
}

/** 첨부 하나를 둘러싼 버전 상태(listFileVersions 의 결과) */
export type FileVersionState = {
  /** 이 첨부 */
  attachmentId: string
  channelId: string
  /** 계보 키(= v1 첨부 id) */
  rootId: string
  /** 최신 → 오래된 순 */
  versions: FileVersionItem[]
  /** 이 첨부의 번호 */
  versionNo: number
  latestId: string | null
  finalId: string | null
  /** 지금 유효한 수정 중 정보 */
  checkout: FileCheckout | null
  /** 내가 이 파일을 고칠 수 있나(편집 권한 판정) */
  canEdit: boolean
  /** 사본으로 새 문서를 만들 수 있나(편집 권한 + 최상위 게시 규칙, docs/16 §6) */
  canCopy?: boolean
  /** 관리자(남의 수정 중 해제 가능) */
  isAdmin: boolean
  /** 지금 보는 사용자 id — 브라우저에 남는 편집 핸들의 소유자 확인용 */
  viewerId: string
}

export type EditActor = { isGuest: boolean; isMember: boolean }
export type EditTarget = { channelArchived: boolean; messageDeleted: boolean }

/**
 * 편집 권한 = 채널 멤버인 내부 staff, 보관 채널 불가, 삭제된 게시물의 첨부 불가(§2·§5).
 * 읽기 가능 여부는 호출부가 RLS 조회로 이미 확인했다.
 */
export function canEditFile(actor: EditActor, target: EditTarget): boolean {
  return !actor.isGuest && actor.isMember && !target.channelArchived && !target.messageDeleted
}

/** 거절 문구(서버 액션) — 판정과 같은 순서. 편집할 수 있으면 null */
export function editDeniedMessage(actor: EditActor, target: EditTarget): string | null {
  if (actor.isGuest) return '서브관리자는 파일을 수정할 수 없습니다.'
  if (target.messageDeleted) return '삭제된 게시물의 파일입니다.'
  if (!actor.isMember) return '이 채널의 멤버만 파일 버전을 올릴 수 있습니다.'
  if (target.channelArchived) return '보관된 채널의 파일은 수정할 수 없습니다.'
  return null
}

/** 수정 중 유효 여부 — checkout_until 이 지금보다 뒤일 때만 */
export function isCheckoutActive(
  lineage: { checkout_user_id: string | null; checkout_until: string | null } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lineage?.checkout_user_id || !lineage.checkout_until) return false
  const until = Date.parse(lineage.checkout_until)
  return Number.isFinite(until) && until > now.getTime()
}

export function checkoutDeadline(now: Date = new Date()): Date {
  return new Date(now.getTime() + CHECKOUT_HOURS * 60 * 60 * 1000)
}

/** 계보 키 — v1 은 자기 id */
export function lineageRootId(row: { id: string; version_root_id: string | null }): string {
  return row.version_root_id ?? row.id
}

type LineageRow = {
  id: string
  version_no: number
  deleted: boolean
}

/** 계보에서 지금 최신(삭제 안 된 가장 높은 번호). 없으면 null — DB 의 is_latest 와 같은 규칙 */
export function pickLatest<T extends LineageRow>(rows: readonly T[]): T | null {
  let best: T | null = null
  for (const r of rows) {
    if (r.deleted) continue
    if (!best || r.version_no > best.version_no) best = r
  }
  return best
}

/** 최신 → 오래된 순 */
export function sortVersionsDesc<T extends { version_no: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.version_no - a.version_no)
}

/**
 * 파일 탭의 "이전 버전" 목록: 계보(최신 → 오래된)에 백필 전 데이터용 config.history 를 합친다(중복 제거).
 * 계보에 이미 있는 id 는 계보 쪽을 쓴다. current 는 목록에서 뺀다.
 */
export function mergeHistoryIds(
  lineageIdsDesc: readonly string[],
  configHistory: readonly string[],
  currentId: string
): string[] {
  const key = (v: string) => v.toLowerCase()
  const seen = new Set<string>([key(currentId)])
  const out: string[] = []
  for (const id of [...lineageIdsDesc, ...configHistory]) {
    if (seen.has(key(id))) continue
    seen.add(key(id))
    out.push(id)
  }
  return out
}

/** 확장자(점 없이 소문자). 없으면 '' */
export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  if (i <= 0 || i === fileName.length - 1) return ''
  return fileName.slice(i + 1).toLowerCase()
}

/** 같은 문서로 보는 확장자 쌍(한글·워드·엑셀·파워포인트의 옛/새 형식) */
const COMPATIBLE_EXTENSIONS: readonly (readonly string[])[] = [
  ['hwp', 'hwpx'],
  ['doc', 'docx'],
  ['xls', 'xlsx'],
  ['ppt', 'pptx'],
]

/** 새 파일의 확장자가 원본과 같거나 호환되는가. 어느 한쪽이 확장자가 없으면 묻지 않는다. */
export function extensionsMatch(originalName: string, newName: string): boolean {
  const a = extensionOf(originalName)
  const b = extensionOf(newName)
  if (!a || !b || a === b) return true
  return COMPATIBLE_EXTENSIONS.some(g => g.includes(a) && g.includes(b))
}

/**
 * 숫자를 한국어로 읽었을 때 끝소리에 받침이 있으면 '을', 없으면 '를'.
 * 끝자리 2(이)·4(사)·5(오)·9(구)만 받침이 없다. 0 으로 끝나면 십·백·천·만으로 읽혀 받침이 있다.
 */
export function objectParticleForNumber(n: number): '을' | '를' {
  const last = Math.abs(Math.trunc(n)) % 10
  return last === 2 || last === 4 || last === 5 || last === 9 ? '를' : '을'
}

/** "A님이 '보고서.hwp' v3을 올렸습니다." / "… v2를 올렸습니다." */
export function versionUploadedBody(
  actorName: string,
  fileName: string,
  versionNo: number
): string {
  return `${escapeMarkdownInline(actorName)}님이 '${escapeMarkdownInline(fileName)}' v${versionNo}${objectParticleForNumber(versionNo)} 올렸습니다.`
}

/** "A님이 '보고서.hwp'를 v2 내용으로 되돌렸습니다(v4)." */
export function versionRestoredBody(
  actorName: string,
  fileName: string,
  restoredFromNo: number,
  newNo: number
): string {
  return `${escapeMarkdownInline(actorName)}님이 '${escapeMarkdownInline(fileName)}'를 v${restoredFromNo} 내용으로 되돌렸습니다(v${newNo}).`
}

/** 목록·상세의 `v3` 배지 글자 — 2 이상일 때만 */
export function versionLabel(versionNo: number): string | null {
  return versionNo >= 2 ? `v${versionNo}` : null
}

/** 공지 채널(post_policy='owners')이면 owner·관리자만 최상위 게시물 — 그 밖에는 답글로 내린다(§4) */
export function shouldPostTopLevel(opts: {
  announce: boolean
  postPolicy: string
  isChannelOwner: boolean
  isAdmin: boolean
}): boolean {
  if (!opts.announce) return false
  if (opts.postPolicy === 'owners') return opts.isChannelOwner || opts.isAdmin
  return true
}

/** 수정 중 확인 문구: "김OO님이 10:32부터 수정 중입니다." (시각은 호출부가 포맷해 넘긴다) */
export function checkoutHeldMessage(userName: string | null, sinceLabel: string): string {
  return `${userName ?? '다른 사용자'}님이 ${sinceLabel}부터 수정 중입니다.`
}

/** 수정 중 안내용 짧은 시각 — `formatDateTime`(오늘 HH:mm / 올해 M월 d일 HH:mm / 다른 해 연도 포함). 잘못된 값은 빈 문자열 */
export function formatSinceLabel(iso: string, now: Date = new Date()): string {
  if (Number.isNaN(new Date(iso).getTime())) return ''
  return formatDateTime(iso, now)
}
