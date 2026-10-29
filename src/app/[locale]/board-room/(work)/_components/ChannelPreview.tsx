import type { loadChannelViewData } from '@work/lib/channels/load-view'

/**
 * 1단계 서버 이식 동안의 임시 채널 화면 — 원본 ChannelView를 옮기기 전까지 권한 E2E와 손 확인용으로만 쓴다.
 * 본문은 텍스트로만 그린다(마크다운 렌더 없음 — React가 이스케이프한다).
 */
export function ChannelPreview({
  title,
  channelId,
  view,
}: {
  title: string
  channelId: string
  view: Awaited<ReturnType<typeof loadChannelViewData>>
}) {
  const names = new Map(view.staff.map(s => [s.user_id, s.display_name]))
  return (
    <main
      className="flex flex-1 flex-col gap-3 overflow-auto bg-background p-6 text-foreground"
      data-testid="board-work-channel"
      data-channel-id={channelId}
      data-channel-rev={view.rev}
    >
      <h1 className="font-heading text-xl font-semibold">{title}</h1>
      <ol className="flex flex-col gap-2 text-sm">
        {view.page.messages.map(m => (
          <li key={m.id} data-testid="board-work-message" data-message-id={m.id}>
            <span className="font-medium">
              {m.author_id ? (names.get(m.author_id) ?? '알 수 없음') : '시스템'}
            </span>{' '}
            <span>{m.deleted_at ? '(삭제된 메시지)' : m.body}</span>
          </li>
        ))}
      </ol>
    </main>
  )
}
