import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildAssignmentPush } from '../../src/lib/mail/assigneePush.ts'

test('지정 푸시는 이사회 메일함의 그 메일로 연결되고 같은 메일의 알림은 합쳐진다', () => {
  const push = buildAssignmentPush({ emailId: 'abc', subject: '대관 문의', assignerName: '홍길동' })
  assert.deepEqual(push, {
    title: '메일 담당자로 지정됐습니다',
    body: '홍길동 님이 맡겼습니다: 대관 문의',
    url: '/board-room/mailbox?mail=abc',
    tag: 'mailbox-assign-abc',
  })
})

test('업무툴 서비스 워커가 여는 범위(/board-room/ 아래)를 벗어나지 않는다', () => {
  const push = buildAssignmentPush({ emailId: '../../x?y', subject: null, assignerName: null })
  assert.ok(push.url.startsWith('/board-room/mailbox?mail='))
  assert.ok(!push.url.includes('/../'))
})

test('제목이 없거나 길면 다듬는다 — 지정한 사람을 모르면 제목만', () => {
  assert.equal(
    buildAssignmentPush({ emailId: 'a', subject: '  ', assignerName: '' }).body,
    '(제목 없음)'
  )
  const long = buildAssignmentPush({ emailId: 'a', subject: 'x'.repeat(100), assignerName: null })
  assert.equal(long.body, `${'x'.repeat(80)}…`)
})
