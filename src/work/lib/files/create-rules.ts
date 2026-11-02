/**
 * ggac 이식 1b 자리표시 — 원본 `lib/files/create-rules.ts`에서 채팅 화면이 쓰는 타입만 둔다.
 * 2단계(자료실·편집기)에서 원본 전체로 바꾼다(`port-from-kosmart.mjs --force`).
 */
export type CreateActor = {
  isGuest: boolean
  isMember: boolean
  archived: boolean
  postPolicy: string | null | undefined
  isChannelOwner: boolean
  isAdmin: boolean
  /** 스레드 안에서 만든다(parentId 있음) */
  inThread: boolean
}
