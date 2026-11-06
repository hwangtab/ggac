/**
 * 메일함 키보드 단축키 판정 — 순수 함수. 화면(`MailboxView`)이 keydown마다 부르고, 무엇을 할지만 돌려준다.
 * 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약.
 *
 * Gmail과 같은 키를 쓴다. 글을 쓰는 중(입력창·편집 영역)이거나 조합 키(Ctrl·Cmd·Alt)를 누른 상태, 다른 창(답장·작성·
 * 관리 창)이 열려 있으면 아무것도 하지 않는다 — 입력 중인 글자가 명령으로 바뀌면 안 된다.
 */

export type ShortcutAction =
  | 'next'
  | 'prev'
  | 'close'
  | 'search'
  | 'help'
  | 'toggle-select'
  | 'archive'
  | 'spam'
  | 'reply'
  | 'reply-all'
  | 'forward'

export type ShortcutContext = {
  /** 관리자인가 — 상태 바꾸기·답장·고르기는 관리자만이다(서버도 막는다). */
  canManage: boolean
  /** 답장·작성·관리 창 같은 다른 창이 열려 있나. */
  modalOpen: boolean
}

export type KeyEventLike = {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  /** 이벤트가 난 요소 — 입력 중인지 본다. */
  target?: { tagName?: string; isContentEditable?: boolean } | null
}

const MANAGE_ONLY: ReadonlySet<ShortcutAction> = new Set([
  'toggle-select',
  'archive',
  'spam',
  'reply',
  'reply-all',
  'forward',
])

const KEYS: Record<string, ShortcutAction> = {
  j: 'next',
  k: 'prev',
  Escape: 'close',
  u: 'close',
  '/': 'search',
  '?': 'help',
  x: 'toggle-select',
  e: 'archive',
  '!': 'spam',
  r: 'reply',
  a: 'reply-all',
  f: 'forward',
}

function isTyping(target: KeyEventLike['target']): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = String(target.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function mailboxShortcut(
  event: KeyEventLike,
  context: ShortcutContext
): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (context.modalOpen) return null
  if (isTyping(event.target)) return null
  const action = KEYS[event.key]
  if (!action) return null
  if (MANAGE_ONLY.has(action) && !context.canManage) return null
  return action
}

/** 도움말에 보이는 목록 — 판정 표와 같은 키를 쓴다. */
export const SHORTCUT_HELP: { keys: string; label: string; manageOnly: boolean }[] = [
  { keys: 'j / k', label: '다음 · 이전 메일', manageOnly: false },
  { keys: 'Esc / u', label: '목록으로', manageOnly: false },
  { keys: '/', label: '검색', manageOnly: false },
  { keys: '?', label: '이 도움말', manageOnly: false },
  { keys: 'x', label: '지금 메일 고르기', manageOnly: true },
  { keys: 'e', label: '보관', manageOnly: true },
  { keys: '!', label: '스팸', manageOnly: true },
  { keys: 'r', label: '답장', manageOnly: true },
  { keys: 'a', label: '전체 답장', manageOnly: true },
  { keys: 'f', label: '전달', manageOnly: true },
]
