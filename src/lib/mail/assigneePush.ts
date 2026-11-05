/**
 * 메일 담당자 지정 푸시의 본문 — 순수 함수. 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약.
 *
 * 업무툴 서비스 워커(`public/board-work-sw.js`)는 알림을 누르면 **같은 출처의 `/board-room/` 아래로만** 연다.
 * 그래서 이사회 메일함(`/board-room/mailbox`)에 `?mail=<id>`를 붙여 그 메일을 바로 펼친다.
 *
 * 잠금 화면·알림 센터에 보이는 것은 제목과 지정한 사람뿐이다 — 보낸 사람 주소·본문은 싣지 않는다.
 */

export type AssignmentPush = { title: string; body: string; url: string; tag: string }

const SUBJECT_MAX = 80

export function buildAssignmentPush(input: {
  emailId: string
  subject: string | null | undefined
  assignerName: string | null | undefined
}): AssignmentPush {
  const subject = String(input.subject ?? '').trim() || '(제목 없음)'
  const clipped = subject.length > SUBJECT_MAX ? `${subject.slice(0, SUBJECT_MAX)}…` : subject
  const who = String(input.assignerName ?? '').trim()
  return {
    title: '메일 담당자로 지정됐습니다',
    body: who ? `${who} 님이 맡겼습니다: ${clipped}` : clipped,
    url: `/board-room/mailbox?mail=${encodeURIComponent(input.emailId)}`,
    // 같은 메일의 지정 알림은 하나로 합친다(다시 지정되면 최신 것만 남는다).
    tag: `mailbox-assign-${input.emailId}`,
  }
}
