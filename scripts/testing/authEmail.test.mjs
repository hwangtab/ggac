import { test } from 'node:test'
import assert from 'node:assert/strict'

const { renderAuthEmail } = await import('../../src/lib/auth/email.ts')
const { buildMemberProfileRow } = await import('../../src/lib/auth/profileHook.ts')

test('재설정 메일: 제목과 링크가 들어간다', () => {
  const { subject, html } = renderAuthEmail('recovery', 'https://ggac.kr/reset?token=abc')
  assert.equal(subject, '[경기아트콜렉티브] 비밀번호 재설정 안내')
  assert.ok(html.includes('https://ggac.kr/reset?token=abc'))
  assert.ok(html.includes('비밀번호 재설정'))
  assert.ok(!html.includes('{{'), '치환되지 않은 플레이스홀더가 남았다')
})

test('가입 확인 메일: 제목과 링크가 들어간다', () => {
  const { subject, html } = renderAuthEmail('confirmation', 'https://ggac.kr/verify?token=xyz')
  assert.equal(subject, '[경기아트콜렉티브] 회원가입 이메일 인증')
  assert.ok(html.includes('https://ggac.kr/verify?token=xyz'))
  assert.ok(!html.includes('{{'))
})

test('메일: URL의 HTML 특수문자가 이스케이프된다', () => {
  const { html } = renderAuthEmail('recovery', 'https://ggac.kr/r?a=1&b="x"><script>')
  assert.ok(!html.includes('<script>'), 'href에 태그가 그대로 들어갔다')
  assert.ok(html.includes('&amp;'))
  assert.ok(html.includes('&quot;'))
})

test('메일: 알 수 없는 종류는 던진다', () => {
  assert.throws(() => renderAuthEmail('unknown', 'https://ggac.kr'), /알 수 없는/)
})

test('프로필 행: 승인 대기·비활성으로 시작한다', () => {
  const row = buildMemberProfileRow({ id: 'u1', email: 'a@b.kr', name: '홍길동' })
  assert.equal(row.id, 'u1')
  assert.equal(row.email, 'a@b.kr')
  assert.equal(row.display_name, '홍길동')
  assert.equal(row.registration_status, 'pending')
  assert.equal(row.is_active, false)
  assert.equal(row.is_admin, false)
})

test('프로필 행: 이름이 없으면 이메일을 쓴다', () => {
  assert.equal(buildMemberProfileRow({ id: 'u1', email: 'a@b.kr' }).display_name, 'a@b.kr')
  assert.equal(
    buildMemberProfileRow({ id: 'u1', email: 'a@b.kr', name: null }).display_name,
    'a@b.kr'
  )
  assert.equal(
    buildMemberProfileRow({ id: 'u1', email: 'a@b.kr', name: '  ' }).display_name,
    'a@b.kr'
  )
})

test('프로필 행: 관리자 권한을 절대 켜지 않는다', () => {
  const row = buildMemberProfileRow({ id: 'u1', email: 'a@b.kr', name: 'x' })
  for (const key of ['is_admin', 'is_director', 'is_auditor', 'is_active']) {
    assert.equal(row[key], false, key + '가 켜져 있다')
  }
  assert.equal(row.registration_status, 'pending')
})

test('프로필 행: id나 email이 없으면 던진다', () => {
  assert.throws(() => buildMemberProfileRow({ id: '', email: 'a@b.kr' }), /필수/)
  assert.throws(() => buildMemberProfileRow({ id: 'u1', email: '' }), /필수/)
})
