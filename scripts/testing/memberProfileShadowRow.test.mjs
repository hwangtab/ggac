import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

/**
 * `src/lib/auth/server.ts`의 `ensureSupabaseMemberProfileShadowRow`(가입 훅
 * 내부 비공개 함수, 9pre 수정 2)가 실제로 하는 일을 로컬 Supabase 스택에
 * 그대로 재현해 검증한다:
 *   1) NOT NULL 컬럼(id·email·display_name)만 채운 최소 insert가 실제로
 *      행을 만들고, registration_status·is_active·is_admin은 DB 기본값
 *      (pending/false/false)에 남는다 — 이 함수가 채우지 않았다는 증거.
 *   2) 같은 id+email로 재시도하면 PostgREST가 23505를 주고, 그 값은
 *      `isBenignShadowProfileRetryError`가 무해로 판정하는 바로 그 코드다
 *      (shadowUserGuard.ts의 단위 테스트가 문자열로만 확인하는 것을 여기서
 *      실제 DB 응답으로 재확인한다).
 *   3) 부정 대조(과제가 명시한 그 시나리오): 이 그림자 행이 **없으면**
 *      board_meeting_date_votes.voter_id처럼 member_profiles(id)를 참조하는
 *      NOT NULL FK가 23503으로 막힌다는 것을 실제로 재현하고, 그림자 행을
 *      만든 뒤에는 같은 쓰기가 성공하는 것까지 확인한다.
 *
 * `server.ts`를 직접 import하지 않는다 — `betterAuth()` 초기화가
 * `BETTER_AUTH_SECRET` 등 여러 환경변수와 next/headers 요청 스코프에 얽혀
 * 있어(`turso-stage2c-memberRoutes.test.mjs` 서두 주석이 설명하는 것과 같은
 * 제약) `node --test`에서 안전하게 단독 로드할 수 없다. 그래서 이 함수가
 * 실제로 실행하는 것과 동일한 insert 호출 시퀀스를 여기서 재현한다.
 *
 * `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`가 없으면(기본
 * `npm run test:unit` 실행 — 이 워크트리에는 `.env.local`이 없다) 스킵한다.
 * `supabase start`로 로컬 스택을 띄운 뒤 두 값을 넣어야 실행된다
 * (`scripts/testing/turso-blob-smoke.test.mjs`와 같은 skip 패턴).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLocalSupabase = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY)

let admin
let isBenignShadowProfileRetryError

if (hasLocalSupabase) {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  ;({ isBenignShadowProfileRetryError } = await import('../../src/lib/auth/shadowUserGuard.ts'))
}

/** ensureSupabaseMemberProfileShadowRow와 정확히 같은 호출 모양. */
async function insertShadowProfileRow(id, email, name) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  return admin.from('member_profiles').insert({ id, email, display_name: trimmedName || email })
}

const cleanupIds = []

after(async () => {
  if (!hasLocalSupabase) return
  for (const id of cleanupIds) {
    await admin.from('member_profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
})

test(
  '최소 insert는 NOT NULL 컬럼만 채우고 나머지는 DB 기본값에 남는다',
  { skip: !hasLocalSupabase },
  async () => {
    const id = crypto.randomUUID()
    const email = `shadow-min-${Date.now()}@test.local`
    cleanupIds.push(id)

    await admin.auth.admin.createUser({ id, email, email_confirm: true })
    const { error: insertError } = await insertShadowProfileRow(id, email, '  ')
    assert.equal(insertError, null)

    const { data: row, error: selectError } = await admin
      .from('member_profiles')
      .select('*')
      .eq('id', id)
      .single()
    assert.equal(selectError, null)
    assert.equal(row.email, email)
    // name이 공백뿐이면 email로 폴백한다(buildMemberProfileRow와 같은 규칙).
    assert.equal(row.display_name, email)
    // 이 함수가 값을 채우지 않은 컬럼은 DB 기본값이어야 한다 — 채웠다면
    // 이 행이 registration_status 등의 "또 다른 진실 출처"가 된다는 뜻이다.
    assert.equal(row.registration_status, 'pending')
    assert.equal(row.is_active, false)
    assert.equal(row.is_admin, false)
  }
)

test(
  '같은 id+email로 재시도하면 PostgREST 23505를 주고, 그 값은 isBenignShadowProfileRetryError가 무해로 본다',
  { skip: !hasLocalSupabase },
  async () => {
    const id = crypto.randomUUID()
    const email = `shadow-retry-${Date.now()}@test.local`
    cleanupIds.push(id)

    await admin.auth.admin.createUser({ id, email, email_confirm: true })
    const first = await insertShadowProfileRow(id, email, '재시도')
    assert.equal(first.error, null)

    const second = await insertShadowProfileRow(id, email, '재시도')
    assert.ok(second.error, '재시도가 실제로 충돌해야 한다')
    assert.equal(second.error.code, '23505')
    assert.equal(
      isBenignShadowProfileRetryError(second.error),
      true,
      '실제 DB가 준 에러가 무해 판정 기준과 맞아떨어져야 한다'
    )

    // 재시도 후에도 행은 하나뿐이다(행이 늘지 않는다 — 진짜 멱등).
    const { data: rows } = await admin.from('member_profiles').select('id').eq('id', id)
    assert.equal(rows.length, 1)
  }
)

test(
  '부정 대조: 그림자 행이 없으면 board_meeting_date_votes.voter_id FK가 23503으로 막고, 그림자 행을 만들면 통과한다',
  { skip: !hasLocalSupabase },
  async () => {
    const voterId = crypto.randomUUID()
    const voterEmail = `shadow-fk-${Date.now()}@test.local`
    cleanupIds.push(voterId)

    // auth.users 껍데기(1번 그림자 행)만 만들고, member_profiles 그림자 행은
    // 아직 만들지 않는다 — "그림자 행 생성을 지웠을 때"를 재현한다.
    await admin.auth.admin.createUser({ id: voterId, email: voterEmail, email_confirm: true })

    // board_meetings/board_meeting_date_options는 이 이사회 서재 쓰기가
    // 기대는 최소한의 부모 행이다. created_by는 nullable이라 비워도 된다.
    const { data: meeting, error: meetingError } = await admin
      .from('board_meetings')
      .insert({ title: '부정 대조용 회의' })
      .select('id')
      .single()
    assert.equal(meetingError, null)

    const { data: option, error: optionError } = await admin
      .from('board_meeting_date_options')
      .insert({ meeting_id: meeting.id, candidate_date: '2026-09-01' })
      .select('id')
      .single()
    assert.equal(optionError, null)

    // (a) 그림자 행이 없는 상태 — FK 위반으로 막혀야 한다.
    const beforeShadow = await admin
      .from('board_meeting_date_votes')
      .insert({ option_id: option.id, voter_id: voterId, is_available: true })
    assert.ok(beforeShadow.error, '그림자 행이 없으면 실패해야 한다')
    assert.equal(beforeShadow.error.code, '23503', 'FK 위반(23503)이어야 한다')

    // (b) 그림자 행을 만든 뒤에는 같은 쓰기가 성공해야 한다.
    const shadowResult = await insertShadowProfileRow(voterId, voterEmail, '부정대조 이사')
    assert.equal(shadowResult.error, null)

    const afterShadow = await admin
      .from('board_meeting_date_votes')
      .insert({ option_id: option.id, voter_id: voterId, is_available: true })
    assert.equal(afterShadow.error, null, '그림자 행을 만든 뒤에는 성공해야 한다')

    // 정리 — 자식부터 지운다(board_meetings CASCADE가 옵션·투표를 함께
    // 지우지만, 명시적으로 지워 다른 테스트와 순서가 엇갈려도 안전하게 한다).
    await admin.from('board_meeting_date_votes').delete().eq('option_id', option.id)
    await admin.from('board_meeting_date_options').delete().eq('id', option.id)
    await admin.from('board_meetings').delete().eq('id', meeting.id)
  }
)
