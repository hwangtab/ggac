import type { CreateActor } from '@work/lib/files/create-rules'

/**
 * ggac 이식 2a 자리표시 — 새 문서 만들기(오피스·HWPX 편집기, 원본 `create-document/NewDocumentMenu.tsx`)는 3단계다.
 * 자료실·채널 파일 탭이 원본과 같은 자리에서 부르지만 지금은 단추를 그리지 않는다.
 */
export default function NewDocumentMenu(_props: {
  channelId: string
  folderPath?: string | null
  actor: Omit<CreateActor, 'inThread'>
}) {
  return null
}
