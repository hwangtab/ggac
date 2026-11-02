/**
 * 채널 글쓰기 권한(0028 channels.post_policy) — 공지 채널. 순수 모듈(서버 액션 파일은 async 만 export 할 수 있다).
 * 'owners': 최상위 글은 채널 owner·업무툴 관리자만, 답글은 모두. DB 가 messages 하드닝 트리거로 강제하고
 * 화면은 같은 규칙으로 입력창을 안내문으로 바꾼다.
 */
export type PostPolicy = 'everyone' | 'owners'

export const POST_POLICY_OPTIONS: { value: PostPolicy; label: string; hint: string }[] = [
  { value: 'everyone', label: '모두', hint: '채널 멤버 누구나 글을 올립니다.' },
  {
    value: 'owners',
    label: '소유자·관리자만',
    hint: '소유자와 관리자만 새 글을 올립니다. 답글은 모두 달 수 있습니다.',
  },
]

export const POST_RESTRICTED_NOTICE = '이 채널은 소유자만 글을 올릴 수 있습니다'

export function normalizePostPolicy(value: string | null | undefined): PostPolicy {
  return value === 'owners' ? 'owners' : 'everyone'
}

/** 최상위 글을 올릴 수 있는가(답글은 정책과 무관) */
export function canPostTopLevel(opts: {
  policy: PostPolicy | undefined
  isChannelOwner: boolean
  isWorkAdmin: boolean
}): boolean {
  return opts.policy !== 'owners' || opts.isChannelOwner || opts.isWorkAdmin
}
