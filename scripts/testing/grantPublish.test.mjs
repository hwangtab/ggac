import { test } from 'node:test'
import assert from 'node:assert/strict'

const { runGrantPublish, isEmailOptedOut } = await import('../../src/lib/server/grantPublish.ts')

function item(over = {}) {
  return {
    key: 'ncas:1',
    source: 'ncas',
    source_id: '1',
    title: '음악 창작지원',
    genres: ['음악'],
    regions: ['경기'],
    category: 'grant',
    apply_start: null,
    apply_end: '2026-10-15',
    url: 'https://example.test/1',
    summary: null,
    biz_type: null,
    target: null,
    ...over,
  }
}

function member(over = {}) {
  return {
    id: 'u1',
    email: 'a@example.test',
    display_name: '가나',
    interest_genres: [],
    interest_regions: [],
    ...over,
  }
}

/** 기본 배선 — 모든 것이 성공하는 세계. */
function harness(over = {}) {
  const calls = { posts: [], notifications: [], emails: [], logs: [] }
  return {
    calls,
    input: {
      digest: { id: 'd1', week_key: '2026-W36', items: [item()], status: 'draft' },
      authorId: 'admin-1',
      members: [member()],
      settingsByUserId: new Map(),
      siteUrl: 'https://www.ggac.kr',
      now: new Date('2026-09-01T00:00:00+09:00'),
      createPost: async input => {
        calls.posts.push(input)
        return { id: 'post-1' }
      },
      createBulkNotifications: async input => {
        calls.notifications.push(input)
        return input.user_ids.length
      },
      sendEmail: async input => {
        calls.emails.push(input)
      },
      log: {
        info: (...a) => calls.logs.push(['info', ...a]),
        error: (...a) => calls.logs.push(['error', ...a]),
      },
      ...over,
    },
  }
}

// ---------------------------------------------------------------- 정상 경로

test('게시글 → 알림 → 메일 순서로 나간다', async () => {
  const h = harness()
  const result = await runGrantPublish(h.input)
  assert.equal(result.post_id, 'post-1')
  assert.equal(h.calls.posts.length, 1)
  assert.equal(h.calls.notifications.length, 1)
  assert.equal(h.calls.emails.length, 1)
  assert.equal(result.email_sent, 1)
  assert.equal(result.email_failed, 0)
})

test('게시글은 지원사업 카테고리로, 고정하지 않고 만든다', async () => {
  const h = harness()
  await runGrantPublish(h.input)
  const post = h.calls.posts[0]
  assert.equal(post.category, '지원사업')
  assert.equal(post.is_pinned, false)
  assert.equal(post.content_format, 'markdown')
  assert.equal(post.author_id, 'admin-1')
  assert.ok(post.content.includes('음악 창작지원'))
})

test('알림은 배치 한 번으로 나가고 게시글을 가리킨다', async () => {
  const h = harness({
    members: [member({ id: 'u1' }), member({ id: 'u2', email: 'b@example.test' })],
  })
  await runGrantPublish(h.input)
  assert.equal(h.calls.notifications.length, 1)
  const n = h.calls.notifications[0]
  assert.deepEqual(n.user_ids, ['u1', 'u2'])
  assert.equal(n.related_post_id, 'post-1')
  assert.equal(n.type, 'system_notice')
})

// ---------------------------------------------------------------- 수신 거부

test('email_notifications가 false인 회원에게는 메일을 보내지 않는다', async () => {
  const settings = new Map([
    [
      'u2',
      [{ category: 'notification', setting_key: 'email_notifications', setting_value: false }],
    ],
  ])
  const h = harness({
    members: [member({ id: 'u1' }), member({ id: 'u2', email: 'b@example.test' })],
    settingsByUserId: settings,
  })
  const result = await runGrantPublish(h.input)
  assert.equal(h.calls.emails.length, 1)
  assert.equal(h.calls.emails[0].to, 'a@example.test')
  assert.equal(result.email_skipped_optout, 1)
})

test('설정이 없는 회원(미설정)에게는 보낸다', async () => {
  const h = harness({ settingsByUserId: new Map() })
  const result = await runGrantPublish(h.input)
  assert.equal(result.email_sent, 1)
})

test('수신 거부해도 인앱 알림은 받는다', async () => {
  const settings = new Map([
    [
      'u1',
      [{ category: 'notification', setting_key: 'email_notifications', setting_value: false }],
    ],
  ])
  const h = harness({ settingsByUserId: settings })
  await runGrantPublish(h.input)
  assert.deepEqual(h.calls.notifications[0].user_ids, ['u1'])
  assert.equal(h.calls.emails.length, 0)
})

test('isEmailOptedOut은 문자열 "false"도 거부로 읽는다', () => {
  // user_settings.setting_value는 JSON 컬럼이라 true/false가 문자열로 들어오는 경로가 있다.
  assert.equal(
    isEmailOptedOut([
      { category: 'notification', setting_key: 'email_notifications', setting_value: 'false' },
    ]),
    true
  )
  assert.equal(
    isEmailOptedOut([
      { category: 'notification', setting_key: 'email_notifications', setting_value: false },
    ]),
    true
  )
  assert.equal(
    isEmailOptedOut([
      { category: 'notification', setting_key: 'email_notifications', setting_value: true },
    ]),
    false
  )
  assert.equal(isEmailOptedOut([]), false)
  assert.equal(isEmailOptedOut(undefined), false)
})

// ---------------------------------------------------------------- 주소 문제

test('이메일이 없는 회원은 건너뛴다', async () => {
  const h = harness({ members: [member({ id: 'u1', email: null })] })
  const result = await runGrantPublish(h.input)
  assert.equal(h.calls.emails.length, 0)
  assert.equal(result.email_skipped_address, 1)
})

test('형식이 깨진 주소는 건너뛴다 (추측해서 고치지 않는다)', async () => {
  const h = harness({ members: [member({ id: 'u1', email: 'eng10 @naver.com' })] })
  const result = await runGrantPublish(h.input)
  assert.equal(h.calls.emails.length, 0)
  assert.equal(result.email_skipped_address, 1)
})

// ---------------------------------------------------------------- 실패

test('메일 한 통이 실패해도 나머지는 계속 보낸다', async () => {
  let n = 0
  const h = harness({
    members: [member({ id: 'u1' }), member({ id: 'u2', email: 'b@example.test' })],
    sendEmail: async () => {
      n += 1
      if (n === 1) throw new Error('boom')
    },
  })
  const result = await runGrantPublish(h.input)
  assert.equal(result.email_sent, 1)
  assert.equal(result.email_failed, 1)
})

test('알림이 실패해도 발행을 되돌리지 않고 메일까지 보낸다', async () => {
  const h = harness({
    createBulkNotifications: async () => {
      throw new Error('알림 실패')
    },
  })
  const result = await runGrantPublish(h.input)
  assert.equal(result.post_id, 'post-1')
  assert.equal(result.notification_failed, true)
  assert.equal(result.email_sent, 1)
})

test('게시글 생성이 실패하면 던지고 알림·메일을 보내지 않는다', async () => {
  const h = harness({
    createPost: async () => {
      throw new Error('게시글 실패')
    },
  })
  await assert.rejects(() => runGrantPublish(h.input))
  assert.equal(h.calls.notifications.length, 0)
  assert.equal(h.calls.emails.length, 0)
})

// ---------------------------------------------------------------- 제외 항목

test('excluded 항목은 게시글·메일 어디에도 담기지 않는다', async () => {
  const h = harness({
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [
        item({ key: 'a', title: '남는 공고' }),
        item({ key: 'b', title: '빠진 공고', excluded: true }),
      ],
    },
  })
  await runGrantPublish(h.input)
  assert.ok(h.calls.posts[0].content.includes('남는 공고'))
  assert.ok(!h.calls.posts[0].content.includes('빠진 공고'))
  assert.ok(!h.calls.emails[0].html.includes('빠진 공고'))
})

test('활성 항목이 0건이어도 발행은 된다 (없다는 것도 정보다)', async () => {
  const h = harness({
    digest: { id: 'd1', week_key: '2026-W36', status: 'draft', items: [] },
  })
  const result = await runGrantPublish(h.input)
  assert.equal(result.post_id, 'post-1')
  assert.ok(h.calls.posts[0].content.includes('없습니다'))
})

// ---------------------------------------------------------------- 헤더

test('메일에 List-Unsubscribe 헤더가 붙는다', async () => {
  const h = harness()
  await runGrantPublish(h.input)
  const headers = h.calls.emails[0].headers ?? {}
  assert.ok(String(headers['List-Unsubscribe']).includes('/mypage/settings'))
})

// ---------------------------------------------------------------- 개인 필터

test('미설정 회원은 조합 기본값으로 걸러진 메일을 받는다', async () => {
  const h = harness({
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [
        item({ key: 'a', title: 'a-title', genres: ['음악'], regions: ['경기'] }),
        item({ key: 'b', title: 'b-title', genres: ['시각예술'], regions: ['부산'] }),
      ],
    },
  })
  const r = await runGrantPublish(h.input)
  assert.equal(r.email_sent, 1)
  // 메일 본문에 기본값과 맞는 것만 담겼다
  assert.ok(h.calls.emails[0].html.includes('a-title'))
  assert.ok(!h.calls.emails[0].html.includes('b-title'))
})

test('설정한 회원은 자기 관심사로 걸러진 메일을 받는다', async () => {
  const h = harness({
    members: [member({ interest_genres: ['시각예술'], interest_regions: ['부산'] })],
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [
        item({ key: 'a', title: 'a-title', genres: ['음악'], regions: ['경기'] }),
        item({ key: 'b', title: 'b-title', genres: ['시각예술'], regions: ['부산'] }),
      ],
    },
  })
  const r = await runGrantPublish(h.input)
  assert.equal(r.email_sent, 1)
  assert.ok(h.calls.emails[0].html.includes('b-title'))
  assert.ok(!h.calls.emails[0].html.includes('a-title'))
})

test('사람마다 다른 메일이 나간다', async () => {
  const h = harness({
    members: [
      member({ id: 'u1', email: 'a@example.test' }),
      member({
        id: 'u2',
        email: 'b@example.test',
        interest_genres: ['시각예술'],
        interest_regions: ['부산'],
      }),
    ],
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [
        item({ key: 'a', title: 'a-title', genres: ['음악'], regions: ['경기'] }),
        item({ key: 'b', title: 'b-title', genres: ['시각예술'], regions: ['부산'] }),
      ],
    },
  })
  await runGrantPublish(h.input)
  assert.equal(h.calls.emails.length, 2)
  const byTo = Object.fromEntries(h.calls.emails.map(e => [e.to, e.html]))
  assert.ok(byTo['a@example.test'].includes('a-title'))
  assert.ok(!byTo['a@example.test'].includes('b-title'))
  assert.ok(byTo['b@example.test'].includes('b-title'))
  assert.ok(!byTo['b@example.test'].includes('a-title'))
})

test('메일 상한 CAP은 개인별로 적용된다', async () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    item({ key: `k${i}`, title: `t${i}`, genres: ['음악'], regions: ['경기'] })
  )
  const h = harness({
    digest: { id: 'd1', week_key: '2026-W36', status: 'draft', items: many },
  })
  await runGrantPublish(h.input)
  const cards = (h.calls.emails[0].html.match(/border-radius: 8px/g) ?? []).length
  assert.equal(cards, 12) // CAP
})

// ---------------------------------------------------------------- 0건 관측

test('겹치는 공고가 0건이면 메일을 보내지 않고 따로 센다', async () => {
  const h = harness({
    members: [member({ interest_genres: ['문학'], interest_regions: ['제주'] })],
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [item({ key: 'a', genres: ['음악'], regions: ['경기'] })],
    },
  })
  const r = await runGrantPublish(h.input)
  assert.equal(h.calls.emails.length, 0)
  assert.equal(r.email_skipped_nomatch, 1)
  assert.equal(r.zero_match_count, 1)
  assert.equal(r.email_skipped_optout, 0)
  assert.equal(r.email_skipped_address, 0)
})

test('0건 회원도 인앱 알림은 받는다', async () => {
  const h = harness({
    members: [member({ interest_genres: ['문학'], interest_regions: ['제주'] })],
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [item({ key: 'a', genres: ['음악'], regions: ['경기'] })],
    },
  })
  await runGrantPublish(h.input)
  assert.deepEqual(h.calls.notifications[0].user_ids, ['u1'])
})

test('건너뛴 사유가 셋으로 갈린다', async () => {
  const settings = new Map([
    [
      'u2',
      [{ category: 'notification', setting_key: 'email_notifications', setting_value: false }],
    ],
  ])
  const h = harness({
    members: [
      member({ id: 'u1', email: 'a@example.test' }), // 정상
      member({ id: 'u2', email: 'b@example.test' }), // 수신거부
      member({ id: 'u3', email: null }), // 주소 없음
      member({
        id: 'u4',
        email: 'd@example.test',
        interest_genres: ['문학'],
        interest_regions: ['제주'],
      }), // 0건
    ],
    settingsByUserId: settings,
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [item({ key: 'a', genres: ['음악'], regions: ['경기'] })],
    },
  })
  const r = await runGrantPublish(h.input)
  assert.equal(r.email_sent, 1)
  assert.equal(r.email_skipped_optout, 1)
  assert.equal(r.email_skipped_address, 1)
  assert.equal(r.email_skipped_nomatch, 1)
})

// ---------------------------------------------------------------- 게시글은 개인화되지 않는다

test('게시글에는 풀 전체가 담긴다 (개인 필터를 걸지 않는다)', async () => {
  const h = harness({
    members: [member({ interest_genres: ['문학'], interest_regions: ['제주'] })],
    digest: {
      id: 'd1',
      week_key: '2026-W36',
      status: 'draft',
      items: [
        item({ key: 'a', title: 'a-title', genres: ['음악'], regions: ['경기'] }),
        item({ key: 'b', title: 'b-title', genres: ['무용'], regions: ['서울'] }),
      ],
    },
  })
  await runGrantPublish(h.input)
  assert.ok(h.calls.posts[0].content.includes('a-title'))
  assert.ok(h.calls.posts[0].content.includes('b-title'))
})
