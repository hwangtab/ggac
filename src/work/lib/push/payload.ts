import { messageLink } from '../messages/anchor.ts'
import { toPlainText } from '../search/text.ts'

/**
 * 푸시 본문 만들기 — 원본 kosmart-work `lib/push/payload.ts` 그대로(순수). `node --test`가 직접 읽는다.
 * 본문에 싣는 것은 원본과 같다: 제목(작성자·채널 이름), 미리보기 120자(민감 표시 메시지는 본문 없이 안내 문구),
 * 앱 안 경로(`/board-room/...`), 합치기 tag. 첨부 이름·다른 메시지 내용은 싣지 않는다.
 */

/** 서비스 워커(public/board-work-sw.js)가 받는 푸시 페이로드. */
export type PushPayload = {
  title: string
  body: string
  /** 클릭 시 열 업무툴 경로(예: /board-room/c/general#msg-<id>). 서비스 워커가 같은 출처 /board-room/ 아래만 연다 */
  url: string
  /** 같은 tag 는 알림 센터에서 하나로 합쳐진다 */
  tag?: string
}

export type PushReason = 'mention' | 'dm' | 'thread' | 'channel'

export type PushMessageInfo = {
  messageId: string
  /** 스레드 답글이면 부모 메시지 id — 알림 링크가 스레드 패널을 연다 */
  parentId?: string | null
  channelId: string
  channelName: string
  channelSlug: string | null
  channelKind: 'public' | 'private' | 'dm'
  /** 그룹 채팅(kind='dm' + is_group) — 제목에 그룹 이름을 싣는다 */
  isGroup?: boolean
  /** 그룹에 붙인 이름(없으면 null/생략) */
  groupTitle?: string | null
  authorName: string
  body: string
  sensitive: boolean
}

const BODY_MAX = 120

function preview(info: PushMessageInfo): string {
  // 민감 표시 메시지는 잠금 화면·알림 센터에 본문을 싣지 않는다.
  if (info.sensitive) return '민감 정보가 포함된 메시지입니다. 앱에서 확인하세요.'
  const plain = toPlainText(info.body)
  if (!plain) return '첨부 파일을 보냈습니다.'
  return plain.length > BODY_MAX ? `${plain.slice(0, BODY_MAX)}…` : plain
}

/** 알림 클릭 시 열 경로. 채널은 /board-room/c/<slug>, DM 은 /board-room/dm/<channelId>, 답글이면 ?thread=<부모>. */
export function pushUrl(
  info: Pick<
    PushMessageInfo,
    'channelId' | 'channelSlug' | 'channelKind' | 'messageId' | 'parentId'
  >
) {
  return messageLink({
    channelId: info.channelId,
    kind: info.channelKind,
    slug: info.channelSlug,
    messageId: info.messageId,
    parentId: info.parentId,
  })
}

const TITLE_MAX = 100
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

export function buildPushPayload(reason: PushReason, info: PushMessageInfo): PushPayload {
  const groupTitle = info.isGroup ? info.groupTitle?.trim() || null : null
  const where =
    info.channelKind !== 'dm'
      ? ` · #${info.channelName}`
      : groupTitle
        ? ` · ${groupTitle}`
        : info.isGroup
          ? ' · 그룹 채팅'
          : ''
  const title =
    reason === 'mention'
      ? `${info.authorName}님이 회원님을 멘션했습니다${where}`
      : reason === 'dm'
        ? info.isGroup
          ? `${info.authorName}님의 메시지${where}`
          : `${info.authorName}님의 메시지`
        : reason === 'channel'
          ? `${info.authorName}님의 새 글${where}`
          : `${info.authorName}님이 스레드에 답글을 남겼습니다${where}`
  return {
    // 푸시 서비스 본문 한도는 약 4KB(암호화 후). 채널명·표시 이름이 길어도 넘지 않게 제목을 자른다.
    title: clip(title, TITLE_MAX),
    body: preview(info),
    url: pushUrl(info),
    // 같은 채널·종류는 알림 센터에서 합친다
    tag: `${reason}:${info.channelId}`,
  }
}
