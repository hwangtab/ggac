/**
 * 그룹 채팅(3명 이상 대화) 순수 규약 — 설계: docs/04-그룹채팅.md, 마이그레이션 0016.
 * kind='dm' 채널 중 is_group=true 가 그룹이고, dm_key 는 채널마다 유일한 합성 키 'group:<channel_id>'.
 * 이 모듈은 DB·서버 의존이 없다('use server' 파일은 async 함수만 export 할 수 있어 상수·순수 함수는 여기 둔다).
 */

/** 본인 포함 최대 인원(R1·Q4) */
export const GROUP_MAX_MEMBERS = 20
/** 본인 포함 최소 인원 — 2명은 1:1 DM */
export const GROUP_MIN_MEMBERS = 3
/** 그룹 이름(title) 최대 길이 — 0016 channels_title_check */
export const GROUP_TITLE_MAX = 80
/**
 * channels.name 은 not null 이라 그룹은 고정값을 넣는다(Q9). **표시에 쓰지 않는다** — 표시는
 * groupDisplayName(title 또는 참여자 나열). 다이제스트처럼 name 만 보는 곳에서만 "그룹 채팅" 라벨 구분용.
 */
export const GROUP_NAME_PLACEHOLDER = 'group'
/** 이름을 나열할 때 보여 주는 최대 인원(나 제외) */
export const GROUP_NAME_LIST_MAX = 3

/** 그룹의 합성 dm_key */
export function groupKey(channelId: string): string {
  return `group:${channelId.toLowerCase()}`
}

export function isGroupDmKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith('group:')
}

export type GroupMemberName = { id: string; name: string }

/**
 * 그룹 표시 이름. title 이 있으면 그것, 없으면 나를 뺀 참여자 이름을 가나다순으로 나열하고
 * GROUP_NAME_LIST_MAX 명을 넘으면 "외 N명". 나 말고 아무도 없으면 '나'(방어).
 */
export function groupDisplayName(opts: {
  title: string | null | undefined
  members: GroupMemberName[]
  meId: string
}): string {
  const title = opts.title?.trim()
  if (title) return title
  const me = opts.meId.toLowerCase()
  const names = opts.members
    .filter(m => m.id.toLowerCase() !== me)
    .map(m => m.name.trim() || '알 수 없음')
    .sort((a, b) => a.localeCompare(b, 'ko'))
  if (names.length === 0) return '나'
  const head = names.slice(0, GROUP_NAME_LIST_MAX).join(', ')
  const rest = names.length - GROUP_NAME_LIST_MAX
  return rest > 0 ? `${head} 외 ${rest}명` : head
}

/** 두 id 목록이 (순서·대소문자 무시) 같은 집합인가 */
export function sameMemberSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const x = new Set([...a].map(s => s.toLowerCase()))
  const y = new Set([...b].map(s => s.toLowerCase()))
  if (x.size !== y.size) return false
  for (const id of x) if (!y.has(id)) return false
  return true
}

/**
 * Q2: 이름 없는 그룹 후보(channelId → 멤버 id 목록) 중 wanted 와 구성이 같은 것의 id.
 * 여러 개면 입력(Map) 순서의 첫 번째.
 */
export function findSameMembersGroup(
  candidates: Map<string, string[]>,
  wanted: Iterable<string>
): string | null {
  const w = [...wanted]
  for (const [channelId, members] of candidates) {
    if (sameMemberSet(members, w)) return channelId
  }
  return null
}

/**
 * 대화(kind='dm') 채널을 이름이 아닌 "종류"로만 가리킬 때의 라벨(검색·받은편지함·다이제스트·파일 등).
 * name 이 그룹 고정값이면 그룹 채팅, 아니면 다이렉트 메시지.
 */
export function chatKindLabel(channelName: string | null | undefined): string {
  return channelName === GROUP_NAME_PLACEHOLDER ? '그룹 채팅' : '다이렉트 메시지'
}

/** 시스템 메시지 문구(채널 타임라인에 그대로 보인다) */
export const groupMessages = {
  added: (actor: string, added: string[]) => `${actor}님이 ${added.join(', ')}님을 추가했습니다.`,
  left: (actor: string) => `${actor}님이 나갔습니다.`,
  removed: (actor: string, removed: string) => `${actor}님이 ${removed}님을 내보냈습니다.`,
  renamed: (actor: string, title: string | null) =>
    title
      ? `${actor}님이 대화 이름을 '${title}'(으)로 바꿨습니다.`
      : `${actor}님이 대화 이름을 지웠습니다.`,
} as const

/**
 * 대화(kind='dm') 채널의 목록용 라벨. 원본 channels.name 이 고정값('dm'·'group')이면 종류만,
 * 표시 이름이 들어 있으면 "종류 · 이름". (할 일 화면처럼 raw name 을 받는 곳)
 */
export function chatLabelWithName(channelName: string | null | undefined): string {
  const kind = chatKindLabel(channelName)
  if (!channelName || channelName === GROUP_NAME_PLACEHOLDER || channelName === 'dm') return kind
  return `${kind} · ${channelName}`
}
