'use client'

import { Field, FieldLabel, FieldChoice } from '@work/components/ui/field'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowUpToLineIcon,
  LogOutIcon,
  PinIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import {
  addChannelMembers,
  archiveChannel,
  leaveChannel,
  unarchiveChannel,
  updateChannelPostPolicy,
  updateChannelTopic,
} from '@work/lib/channels/actions'
import { POST_POLICY_OPTIONS, type PostPolicy } from '@work/lib/channels/post-policy'
import {
  addGroupMembers,
  createGroupChat,
  leaveGroupChat,
  removeGroupMember,
  renameGroupChat,
} from '@work/lib/channels/group-actions'
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX } from '@work/lib/channels/group'
import type {
  ChannelDetail,
  ChannelMemberSummary,
  MyMembership,
  StaffSummary,
} from '@work/lib/channels/types'
import { STAFF_ROLE_LABEL } from '@work/lib/auth/staff'
import {
  NOTIFY_LEVEL_HINT,
  NOTIFY_LEVEL_LABEL,
  type NotifyLevel,
} from '@work/lib/notifications/levels'
import { activeStatus, statusLine } from '@work/lib/notifications/status'
import ConfirmDialog from '@work/components/ui/confirm-dialog'
import { cn } from '@work/lib/utils'
import { useChannelTopic } from './use-channel-topic'

/**
 * 머리글에서 모바일(<768px)에 숨기는 단추(고정 메시지·상단 고정·알림 수준)와 같은 동작 — 좁은 화면의 머리글이 이름을 밀어내지 않게
 * 정보 패널로 옮겼다. `onToggleStar`·`onChangeNotifyLevel` 은 멤버일 때만 있다.
 */
export type ChannelInfoQuick = {
  pinCount: number
  onOpenPins: () => void
  starred: boolean
  onToggleStar?: () => void
  notifyLevel: NotifyLevel
  notifyOptions: readonly NotifyLevel[]
  onChangeNotifyLevel?: (level: NotifyLevel) => void
}

export type ChannelInfoPanelProps = {
  channel: ChannelDetail
  membership: MyMembership | null
  meId: string
  isAdmin: boolean
  staff: StaffSummary[]
  members: ChannelMemberSummary[]
  quick?: ChannelInfoQuick
}

/**
 * 열린 패널이 최신 props 를 따라가게 하는 작은 저장소. 우측 패널의 content 는 열 때의 노드라
 * 그 뒤 props 가 바뀌어도 모르므로, ChannelView 가 `set` 으로 최신 값을 밀어 넣고 패널은 구독한다.
 * RightPanel 에는 손대지 않는다(content 를 갈아 끼우면 포커스 요청 상태가 어긋난다).
 */
export type ChannelInfoStore = {
  get: () => ChannelInfoPanelProps
  set: (next: ChannelInfoPanelProps) => void
  subscribe: (listener: () => void) => () => void
}

export function createChannelInfoStore(initial: ChannelInfoPanelProps): ChannelInfoStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: next => {
      current = next
      listeners.forEach(l => l())
    },
    subscribe: l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/** 저장소의 최신 props 로 정보 패널을 그린다(패널 content 로 넣는 것은 이쪽). */
export function LiveChannelInfoPanel({ store }: { store: ChannelInfoStore }) {
  const props = useSyncExternalStore(store.subscribe, store.get, store.get)
  return <ChannelInfoPanel {...props} />
}

/**
 * 채널 정보(우측 패널): 주제 편집 · 멤버 목록(접속 중 표시) · 멤버 추가 · 나가기 · 보관.
 * 그룹 채팅(0016)은 주제·보관 대신 이름 바꾸기 · 사람 추가(멤버 누구나) · 내보내기(관리자만) · 나가기, 1:1 DM 은 "사람 추가"로 새 그룹을 만든다.
 * 주제·멤버 추가·보관은 채널 owner·관리자만(RLS 와 같은 기준으로 UI 를 숨기고, 서버가 다시 막는다).
 */
export default function ChannelInfoPanel({
  channel,
  membership,
  meId,
  isAdmin,
  staff,
  members: initialMembers,
  quick,
}: ChannelInfoPanelProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [members, setMembers] = useState(initialMembers)
  const [archiveOpen, setArchiveOpen] = useState(false)
  // 그 밖의 확인 대화상자(그룹 만들기·나가기·보관 해제) — 한 번에 하나만 뜬다
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    confirmLabel: string
    destructive: boolean
    run: () => void
  } | null>(null)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [savedTopic, setSavedTopic] = useState(channel.topic ?? '')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const topicId = useId()
  const searchId = useId()
  const isGroup = channel.kind === 'dm' && channel.isGroup
  const isDm = channel.kind === 'dm' && !isGroup
  const canManage = channel.kind !== 'dm' && (membership?.role === 'owner' || isAdmin)
  const [postPolicy, setPostPolicy] = useState<PostPolicy>(channel.postPolicy ?? 'everyone')
  const postPolicyName = useId()
  // 다른 사람이 바꾼 값(router.refresh 로 새 channel 이 오면)을 따라간다
  useEffect(() => {
    setPostPolicy(channel.postPolicy ?? 'everyone')
  }, [channel.postPolicy])
  const [title, setTitle] = useState(channel.groupTitle ?? '')
  const [savedTitle, setSavedTitle] = useState(channel.groupTitle ?? '')
  const titleId = useId()
  const quickId = useId()
  const notifyName = useId()

  // 열려 있는 동안 다른 사람이 바꾼 값(멤버·이름·주제)을 따라간다. 입력 중인 값은 덮어쓰지 않는다
  // (입력값이 직전 저장값과 같을 때, 곧 편집 중이 아닐 때만 새 값으로 옮긴다).
  useEffect(() => {
    setMembers(initialMembers)
  }, [initialMembers])
  const syncedTitleRef = useRef(channel.groupTitle ?? '')
  useEffect(() => {
    const prev = syncedTitleRef.current
    const next = channel.groupTitle ?? ''
    if (next === prev) return
    syncedTitleRef.current = next
    setSavedTitle(next)
    setTitle(cur => (cur === prev ? next : cur))
  }, [channel.groupTitle])
  const syncedTopicRef = useRef(channel.topic ?? '')
  useEffect(() => {
    const prev = syncedTopicRef.current
    const next = channel.topic ?? ''
    if (next === prev) return
    syncedTopicRef.current = next
    setSavedTopic(next)
    setTopic(cur => (cur === prev ? next : cur))
  }, [channel.topic])
  const { online } = useChannelTopic(membership ? channel.id : null)
  const onlineSet = useMemo(() => new Set(online), [online])

  const staffMap = useMemo(() => new Map(staff.map(s => [s.user_id, s])), [staff])
  const memberIds = useMemo(() => new Set(members.map(m => m.user_id)), [members])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return staff
      .filter(s => s.status === 'active' && !memberIds.has(s.user_id))
      .filter(
        s => s.display_name.toLowerCase().includes(q) || (s.title ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [query, staff, memberIds])

  function report(res: { ok: boolean; error?: string }, okText: string) {
    setMessage(res.ok ? { tone: 'ok', text: okText } : { tone: 'error', text: res.error ?? '' })
  }

  function saveTopic() {
    startTransition(async () => {
      const res = await updateChannelTopic({ channelId: channel.id, topic })
      report(res, '주제를 바꿨습니다.')
      if (res.ok) {
        setSavedTopic(res.data.topic ?? '')
        router.refresh()
      }
    })
  }

  function changePostPolicy(next: PostPolicy) {
    const prev = postPolicy
    setPostPolicy(next)
    startTransition(async () => {
      const res = await updateChannelPostPolicy({ channelId: channel.id, policy: next })
      if (!res.ok) setPostPolicy(prev)
      report(
        res,
        next === 'owners'
          ? '소유자·관리자만 글을 올리게 했습니다.'
          : '모두 글을 올릴 수 있게 했습니다.'
      )
      if (res.ok) router.refresh()
    })
  }

  function add(userId: string) {
    startTransition(async () => {
      const res = await addChannelMembers({ channelId: channel.id, userIds: [userId] })
      report(res, `${staffMap.get(userId)?.display_name ?? '멤버'}님을 추가했습니다.`)
      if (res.ok) {
        setMembers(cur => [
          ...cur,
          { user_id: userId, role: 'member', joined_at: new Date().toISOString() },
        ])
        setQuery('')
        router.refresh()
      }
    })
  }

  function saveTitle() {
    startTransition(async () => {
      const res = await renameGroupChat({ channelId: channel.id, name: title })
      report(res, res.ok && !res.data.title ? '대화 이름을 지웠습니다.' : '대화 이름을 바꿨습니다.')
      if (res.ok) {
        setSavedTitle(res.data.title ?? '')
        setTitle(res.data.title ?? '')
        router.refresh()
      }
    })
  }

  function addToGroup(userId: string) {
    startTransition(async () => {
      const res = await addGroupMembers({ channelId: channel.id, userIds: [userId] })
      report(res, `${staffMap.get(userId)?.display_name ?? '멤버'}님을 추가했습니다.`)
      if (res.ok) {
        setMembers(cur => [
          ...cur,
          { user_id: userId, role: 'member', joined_at: new Date().toISOString() },
        ])
        setQuery('')
        router.refresh()
      }
    })
  }

  /** 1:1 → 그룹(R4): 지금 상대 + 고른 사람으로 새 그룹을 만든다. 이 1:1 대화는 그대로 남는다. */
  function startGroupFromDm(userId: string) {
    const peer = members.find(m => m.user_id !== meId)
    if (!peer) return
    const names = [peer.user_id, userId].map(id => staffMap.get(id)?.display_name ?? '멤버')
    setConfirm({
      title: `${names.join(', ')}님과 새 그룹 대화를 만들까요?`,
      description: '이 1:1 대화는 그대로 남고, 새 그룹은 이전 대화 없이 시작합니다.',
      confirmLabel: '그룹 만들기',
      destructive: false,
      run: () =>
        startTransition(async () => {
          const res = await createGroupChat({ userIds: [peer.user_id, userId] })
          if (!res.ok) return report(res, '')
          router.push(`/dm/${res.data.id}`)
          router.refresh()
        }),
    })
  }

  /** 그룹에서 내보내기(업무툴 관리자만 — 서버가 다시 확인한다) */
  function removeFromGroup(userId: string) {
    const name = staffMap.get(userId)?.display_name ?? '멤버'
    setConfirm({
      title: `${name}님을 이 그룹 대화에서 내보낼까요?`,
      description: '내보내면 이 대화와 이전 메시지를 더는 볼 수 없습니다. 다시 초대할 수 있습니다.',
      confirmLabel: '내보내기',
      destructive: true,
      run: () =>
        startTransition(async () => {
          const res = await removeGroupMember({ channelId: channel.id, userId })
          report(res, `${name}님을 내보냈습니다.`)
          if (res.ok) {
            setMembers(cur => cur.filter(m => m.user_id !== userId))
            router.refresh()
          }
        }),
    })
  }

  function leaveGroup() {
    setConfirm({
      title: '이 그룹 대화에서 나갈까요?',
      description:
        '나가면 이 대화와 이전 메시지를 볼 수 없습니다. 다시 들어오려면 다른 참여자가 초대해야 합니다.',
      confirmLabel: '나가기',
      destructive: true,
      run: () =>
        startTransition(async () => {
          const res = await leaveGroupChat({ channelId: channel.id })
          if (!res.ok) return report(res, '')
          // 홈(`/`)으로 보내면 마지막 위치(방금 나간 대화)로 되돌아갈 수 있어 섹션 루트로 보낸다
          router.push('/chat')
          router.refresh()
        }),
    })
  }

  function leave() {
    setConfirm({
      title: `#${channel.name} 채널에서 나갈까요?`,
      description:
        channel.kind === 'private'
          ? '비공개 채널이라 나가면 다시 들어올 수 없고, 채널 owner 가 초대해야 합니다.'
          : '나가면 이 채널의 새 글 알림과 목록이 사라집니다. 공개 채널은 언제든 다시 참여할 수 있습니다.',
      confirmLabel: '채널 나가기',
      destructive: true,
      run: () =>
        startTransition(async () => {
          const res = await leaveChannel({ channelId: channel.id })
          if (!res.ok) return report(res, '')
          router.push('/c')
          router.refresh()
        }),
    })
  }

  function archive() {
    setArchiveOpen(false)
    startTransition(async () => {
      const res = await archiveChannel({ channelId: channel.id })
      if (!res.ok) return report(res, '')
      router.push('/c')
      router.refresh()
    })
  }

  function unarchive() {
    setConfirm({
      title: `#${channel.name} 채널의 보관을 해제할까요?`,
      description: '다시 메시지를 쓰고 탭·메모·할 일을 바꿀 수 있게 됩니다.',
      confirmLabel: '보관 해제',
      destructive: false,
      run: () =>
        startTransition(async () => {
          const res = await unarchiveChannel({ channelId: channel.id })
          report(res, '보관을 해제했습니다.')
          if (res.ok) router.refresh()
        }),
    })
  }

  const sortedMembers = [...members].sort((a, b) =>
    (staffMap.get(a.user_id)?.display_name ?? '').localeCompare(
      staffMap.get(b.user_id)?.display_name ?? '',
      'ko'
    )
  )

  return (
    <div className="space-y-6 p-4 text-sm">
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        confirmLabel={confirm?.confirmLabel ?? '확인'}
        destructive={confirm?.destructive ?? true}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const run = confirm?.run
          setConfirm(null)
          run?.()
        }}
      />
      {isGroup && membership && (
        <Field size="sm">
          <FieldLabel htmlFor={titleId}>대화 이름</FieldLabel>
          <Input
            id={titleId}
            value={title}
            maxLength={GROUP_TITLE_MAX}
            placeholder="이름이 없으면 참여자 이름으로 보입니다"
            onChange={e => setTitle(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            onClick={saveTitle}
            disabled={pending || title.trim() === savedTitle.trim()}
          >
            이름 저장
          </Button>
        </Field>
      )}

      {quick && (
        <section aria-labelledby={`${quickId}-h`} className="space-y-3">
          <h3 id={`${quickId}-h`} className="text-xs font-semibold text-muted-foreground">
            내 설정
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={quick.onOpenPins}>
              <PinIcon aria-hidden="true" />
              고정 메시지{quick.pinCount > 0 ? ` ${quick.pinCount}개` : ''}
            </Button>
            {quick.onToggleStar && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={quick.onToggleStar}
                aria-pressed={quick.starred}
              >
                <ArrowUpToLineIcon
                  aria-hidden="true"
                  className={cn(quick.starred && 'fill-current text-primary')}
                />
                {quick.starred ? '고정 해제' : '상단에 고정'}
              </Button>
            )}
          </div>
          {quick.onChangeNotifyLevel && (
            <div role="radiogroup" aria-label="이 대화의 알림" className="flex flex-col gap-2">
              {quick.notifyOptions.map(level => (
                <FieldChoice key={level} className="cursor-pointer">
                  <input
                    type="radio"
                    name={notifyName}
                    value={level}
                    checked={quick.notifyLevel === level}
                    onChange={() => quick.onChangeNotifyLevel?.(level)}
                  />
                  <span>
                    <span className="font-medium">알림: {NOTIFY_LEVEL_LABEL[level]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {NOTIFY_LEVEL_HINT[level]}
                    </span>
                  </span>
                </FieldChoice>
              ))}
            </div>
          )}
        </section>
      )}

      {channel.kind !== 'dm' && (
        <section aria-labelledby={`${topicId}-h`} className="space-y-2">
          <h3 id={`${topicId}-h`} className="text-xs font-semibold text-muted-foreground">
            주제
          </h3>
          {canManage && !channel.archived_at ? (
            <div className="space-y-2">
              <label htmlFor={topicId} className="sr-only">
                채널 주제
              </label>
              <Input
                id={topicId}
                value={topic}
                maxLength={250}
                placeholder="이 채널에서 무엇을 이야기하나요?"
                onChange={e => setTopic(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                onClick={saveTopic}
                disabled={pending || topic.trim() === savedTopic.trim()}
              >
                주제 저장
              </Button>
            </div>
          ) : (
            <p className={cn(!savedTopic && 'text-muted-foreground')}>
              {savedTopic || '주제가 없습니다.'}
            </p>
          )}
        </section>
      )}

      {channel.kind !== 'dm' && (
        <section aria-labelledby={`${postPolicyName}-h`} className="space-y-2">
          <h3 id={`${postPolicyName}-h`} className="text-xs font-semibold text-muted-foreground">
            글쓰기 권한
          </h3>
          {canManage && !channel.archived_at ? (
            <div
              role="radiogroup"
              aria-labelledby={`${postPolicyName}-h`}
              className="flex flex-col gap-2"
            >
              {POST_POLICY_OPTIONS.map(o => (
                <FieldChoice key={o.value} className="cursor-pointer">
                  <input
                    id={`${postPolicyName}-${o.value}`}
                    type="radio"
                    name={postPolicyName}
                    value={o.value}
                    checked={postPolicy === o.value}
                    disabled={pending}
                    onChange={() => changePostPolicy(o.value)}
                  />
                  <span>
                    <span className="font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </FieldChoice>
              ))}
            </div>
          ) : (
            <p>{POST_POLICY_OPTIONS.find(o => o.value === postPolicy)?.hint}</p>
          )}
        </section>
      )}

      <section aria-labelledby={`${searchId}-members`} className="space-y-2">
        <h3 id={`${searchId}-members`} className="text-xs font-semibold text-muted-foreground">
          멤버 {members.length}명
        </h3>
        <ul className="space-y-1">
          {sortedMembers.map(m => {
            const s = staffMap.get(m.user_id)
            const isOnline = onlineSet.has(m.user_id)
            // 상태 메시지(0027) — 만료는 여기서 거른다
            const memberStatus = activeStatus(s)
            return (
              <li key={m.user_id} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 rounded-w-lg',
                    isOnline ? 'bg-online' : 'border border-muted-foreground'
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {s?.display_name ?? '알 수 없음'}
                  {m.user_id === meId && ' (나)'}
                  {s?.title && (
                    <span className="ml-1 text-xs text-muted-foreground">{s.title}</span>
                  )}
                  {memberStatus && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {statusLine(memberStatus)}
                    </span>
                  )}
                </span>
                <span className="sr-only">{isOnline ? '접속 중' : '자리 비움'}</span>
                {m.role === 'owner' && channel.kind !== 'dm' && (
                  <span className="text-xs text-muted-foreground">채널 소유자</span>
                )}
                {s?.role === 'guest' && (
                  <span className="text-xs text-muted-foreground">{STAFF_ROLE_LABEL.guest}</span>
                )}
                {isGroup && membership && isAdmin && m.user_id !== meId && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => removeFromGroup(m.user_id)}
                    aria-label={`${s?.display_name ?? '멤버'}님 내보내기`}
                  >
                    <UserMinusIcon aria-hidden="true" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {canManage && !channel.archived_at && (
        <Field size="sm">
          <FieldLabel htmlFor={searchId}>멤버 추가</FieldLabel>
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder="이름이나 직함으로 찾기"
            onChange={e => setQuery(e.target.value)}
          />
          {query.trim() && candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">추가할 수 있는 사람이 없습니다.</p>
          )}
          <ul className="space-y-1">
            {candidates.map(s => (
              <li key={s.user_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {s.display_name}
                  {s.title && <span className="ml-1 text-xs text-muted-foreground">{s.title}</span>}
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() => add(s.user_id)}
                  aria-label={`${s.display_name}님 추가`}
                >
                  <UserPlusIcon aria-hidden="true" />
                  추가
                </Button>
              </li>
            ))}
          </ul>
        </Field>
      )}

      {isGroup && membership && (
        <Field size="sm">
          <FieldLabel htmlFor={searchId}>사람 추가</FieldLabel>
          {members.length >= GROUP_MAX_MEMBERS ? (
            <p className="text-xs text-muted-foreground">
              그룹 대화는 {GROUP_MAX_MEMBERS}명까지 참여할 수 있습니다.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                추가한 사람도 이전 대화를 볼 수 있습니다.
              </p>
              <Input
                id={searchId}
                type="search"
                value={query}
                placeholder="이름이나 직함으로 찾기"
                onChange={e => setQuery(e.target.value)}
              />
              {query.trim() && candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">추가할 수 있는 사람이 없습니다.</p>
              )}
              <ul className="space-y-1">
                {candidates.map(s => (
                  <li key={s.user_id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {s.display_name}
                      {s.title && (
                        <span className="ml-1 text-xs text-muted-foreground">{s.title}</span>
                      )}
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={pending}
                      onClick={() => addToGroup(s.user_id)}
                      aria-label={`${s.display_name}님 추가`}
                    >
                      <UserPlusIcon aria-hidden="true" />
                      추가
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Field>
      )}

      {isDm && members.length === 2 && (
        <Field size="sm">
          <FieldLabel htmlFor={searchId}>사람 추가 (새 그룹 대화)</FieldLabel>
          <p className="text-xs text-muted-foreground">
            사람을 더하면 새 그룹 대화가 만들어집니다. 이 1:1 대화는 그대로 남습니다.
          </p>
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder="이름이나 직함으로 찾기"
            onChange={e => setQuery(e.target.value)}
          />
          {query.trim() && candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">추가할 수 있는 사람이 없습니다.</p>
          )}
          <ul className="space-y-1">
            {candidates.map(s => (
              <li key={s.user_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {s.display_name}
                  {s.title && <span className="ml-1 text-xs text-muted-foreground">{s.title}</span>}
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() => startGroupFromDm(s.user_id)}
                  aria-label={`${s.display_name}님과 새 그룹 대화 만들기`}
                >
                  <UsersIcon aria-hidden="true" />
                  그룹 만들기
                </Button>
              </li>
            ))}
          </ul>
        </Field>
      )}

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'text-xs',
            message.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {message.text}
        </p>
      )}

      {isGroup && membership && (
        <section className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" variant="outline" size="sm" onClick={leaveGroup} disabled={pending}>
            <LogOutIcon aria-hidden="true" />
            그룹 나가기
          </Button>
        </section>
      )}

      {channel.kind !== 'dm' && (membership || canManage) && (
        <section className="flex flex-wrap gap-2 border-t pt-4">
          {membership && (
            <Button type="button" variant="outline" size="sm" onClick={leave} disabled={pending}>
              <LogOutIcon aria-hidden="true" />
              채널 나가기
            </Button>
          )}
          {canManage && !channel.archived_at && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setArchiveOpen(true)}
              disabled={pending}
            >
              <ArchiveIcon aria-hidden="true" />
              채널 보관
            </Button>
          )}
          <ConfirmDialog
            open={archiveOpen}
            title={`#${channel.name} 채널을 보관할까요?`}
            description="보관하면 더 이상 메시지를 쓰거나 탭·메모를 바꿀 수 없고, 목록에서 보관됨으로 옮겨집니다. 채널 정보에서 보관을 해제할 수 있습니다."
            confirmLabel="채널 보관"
            onCancel={() => setArchiveOpen(false)}
            onConfirm={archive}
          />
          {canManage && channel.archived_at && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={unarchive}
              disabled={pending}
            >
              <ArchiveRestoreIcon aria-hidden="true" />
              보관 해제
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
