import type { TabBarData } from '@work/lib/tabs/types'
import type { ConversationRef } from './conversation-tabs'

/**
 * ggac 이식 1b 자리표시 — 대화 탭 바(게시물·파일·추가 탭)는 2단계(대화 탭·노트·할 일·자료실)에서 원본
 * `components/chat/ConversationTabBar.tsx`로 바꾼다. 지금은 게시물 탭 하나뿐이라 바를 그리지 않는다.
 */
export default function ConversationTabBar(_props: {
  conversation: ConversationRef
  activeKey: string
  data?: TabBarData
}) {
  return null
}
