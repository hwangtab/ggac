import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SETTING_MAPPINGS,
  buildLoginPolicyValue,
  buildPasswordPolicyValue,
  buildRegistrationEnabledValue,
  buildSessionConfigValue,
  isClientEchoOfServedValue,
  seedSettingGroup,
  valueServedToClient,
} from '../../src/lib/server/systemSettingsMapping.ts'

/**
 * 최종 리뷰 B-3의 사고를 **실제로 재현**하고 막히는지 확인한다.
 *
 * 사고 경로:
 *   1. `GET /api/admin/settings`는 `is_sensitive` 설정(`smtp_config`)을
 *      `{masked:true, description:...}`로 내려보낸다.
 *   2. 그 값이 SETTING_MAPPINGS의 transform을 지나면 화면에는 빈 문자열과
 *      하드코딩 기본값으로 보인다 — 화면은 진짜 SMTP 값을 **애초에 모른다.**
 *   3. 관리자 화면은 `settings` 객체 **전체**를 PUT했다. 그래서 유지보수 모드
 *      토글 한 번이면 그 마스킹 유래 값들이 그대로 돌아와 진짜 `smtp_config`를
 *      빈 값으로 덮었다.
 *
 * 아래 테스트는 실제 매핑 표(`SETTING_MAPPINGS`)와 실제 마스킹 함수를 그대로
 * 쓴다 — 계약을 다시 적어 두지 않는다.
 */

const STORED_SMTP_ROW = {
  id: 'row-smtp',
  category: 'email',
  setting_key: 'smtp_config',
  setting_value: {
    host: 'smtp.example.net',
    port: 465,
    user: 'ops@ggac.kr',
    password: 'super-secret',
    from_email: 'noreply@ggac.kr',
    from_name: '경기아트콜렉티브',
  },
  description: null,
  is_sensitive: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: null,
  updated_by: null,
}

const emailMappings = SETTING_MAPPINGS.email

test('마스킹된 GET이 화면에 보여 주는 이메일 값(= 진짜 값이 아닌 것)을 그대로 계산한다', () => {
  const served = Object.fromEntries(
    Object.entries(emailMappings).map(([frontendKey, mapping]) => [
      frontendKey,
      valueServedToClient(STORED_SMTP_ROW, mapping),
    ])
  )

  // 진짜 저장값이 아니다 — 마스킹 객체를 transform이 훑은 결과다.
  assert.deepEqual(served, {
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    from_email: 'noreply@ggac.kr',
    from_name: '경기아트콜렉티브',
  })
  assert.notEqual(served.smtp_host, STORED_SMTP_ROW.setting_value.host)
  assert.notEqual(served.smtp_password, STORED_SMTP_ROW.setting_value.password)
})

test('사고 재현: 화면이 마스킹된 값을 그대로 되돌려 보내면 이메일 필드 전부가 무시된다', () => {
  // "유지보수 모드만 토글하고 저장" 시 옛 화면이 보낸 email 페이로드 그대로.
  const echoedPayload = Object.fromEntries(
    Object.entries(emailMappings).map(([frontendKey, mapping]) => [
      frontendKey,
      valueServedToClient(STORED_SMTP_ROW, mapping),
    ])
  )

  const ignored = []
  const written = {}
  for (const [frontendKey, frontendValue] of Object.entries(echoedPayload)) {
    const mapping = emailMappings[frontendKey]
    if (isClientEchoOfServedValue(STORED_SMTP_ROW, mapping, frontendValue)) {
      ignored.push(frontendKey)
      continue
    }
    written[frontendKey] = frontendValue
  }

  assert.deepEqual(ignored.sort(), Object.keys(emailMappings).sort())
  assert.deepEqual(written, {}, '마스킹된 값은 한 필드도 저장 대상이 되면 안 된다')
})

test('관리자가 실제로 새 값을 입력하면 그대로 저장 대상이 된다(거짓 차단 방지)', () => {
  assert.equal(
    isClientEchoOfServedValue(STORED_SMTP_ROW, emailMappings.smtp_host, 'smtp.newhost.example'),
    false
  )
  assert.equal(
    isClientEchoOfServedValue(STORED_SMTP_ROW, emailMappings.smtp_password, '새-비밀번호'),
    false
  )
  assert.equal(isClientEchoOfServedValue(STORED_SMTP_ROW, emailMappings.smtp_port, 2525), false)
  // 비우는 것도 "본 그대로"와 다르면(현재 served 값은 '') ... 여기서는 같으므로 무시된다.
  // 그 한계는 의도한 것이다 — 마스킹 때문에 "비어 보이는 것"과 "비우겠다"를
  // 서버가 구분할 수 없고, 둘 중 데이터를 지키는 쪽을 고른다.
  assert.equal(isClientEchoOfServedValue(STORED_SMTP_ROW, emailMappings.smtp_host, ''), true)
})

test('민감하지 않은 설정에는 적용하지 않는다(같은 값으로 되돌리기를 막으면 안 된다)', () => {
  const siteRow = {
    ...STORED_SMTP_ROW,
    id: 'row-title',
    category: 'site',
    setting_key: 'site_title',
    setting_value: { value: '경기아트콜렉티브' },
    is_sensitive: false,
  }
  assert.equal(
    isClientEchoOfServedValue(siteRow, SETTING_MAPPINGS.site.site_title, '경기아트콜렉티브'),
    false
  )
  // 행 자체가 없으면(신규 키) 차단 대상이 아니다.
  assert.equal(isClientEchoOfServedValue(undefined, SETTING_MAPPINGS.site.site_title, 'x'), false)
})

test('부분 갱신 씨앗: 저장된 객체를 복제해 주고 원본은 건드리지 않는다', () => {
  const seed = seedSettingGroup(STORED_SMTP_ROW.setting_value)
  assert.deepEqual(seed, STORED_SMTP_ROW.setting_value)

  // 호출부는 이 객체에 필드를 대입한다 — 조회 결과가 변형되면 안 된다.
  seed.host = 'smtp.newhost.example'
  assert.equal(STORED_SMTP_ROW.setting_value.host, 'smtp.example.net')

  // 병합 결과: 보내지 않은 형제 필드(비밀번호 등)가 그대로 남는다.
  assert.equal(seed.password, 'super-secret')
  assert.equal(seed.port, 465)
})

test('부정 대조: 씨앗 없이 {}에서 쌓으면 보내지 않은 형제 필드가 사라진다(고치기 전 동작)', () => {
  const withoutSeed = {}
  withoutSeed.host = 'smtp.newhost.example'
  assert.equal(withoutSeed.password, undefined)
  assert.equal(withoutSeed.port, undefined)
})

test('객체가 아닌 저장값은 빈 객체로 시작한다', () => {
  assert.deepEqual(seedSettingGroup(null), {})
  assert.deepEqual(seedSettingGroup(undefined), {})
  assert.deepEqual(seedSettingGroup('문자열'), {})
  assert.deepEqual(seedSettingGroup([1, 2]), {})
})

/**
 * `|| true` 관용복구 — 저장된 `false`가 화면과 저장 양쪽에서 되살아나던 자리들.
 *
 * 세 경우를 **전부** 본다: 저장된 true · 저장된 false · 값 없음.
 * "저장된 true"만 봤다면 고치기 전에도 통과했다 — 이 결함이 그렇게 살아남았다.
 *
 * 값이 없을 때의 기대값은 취향이 아니라 소비처가 정한 것이다:
 *  - features 넷: `@/utils/systemSettings`의 `isFeatureEnabled()`가 `?? true`
 *  - 쓰기 쪽 여섯: 같은 모듈의 `getDefaultSettings()`와 reset 기본값 표가 `true`
 *
 * `require_email_verification`은 이 목록에 없다 — 켜는 쪽이 명시적이어야 하는
 * 스위치라 판정이 `=== true`이고, 읽는 칸도 옛 `required`가 아니다. 아래
 * 펀딩 옆에 따로 둔다.
 */

const DISPLAY_CASES = [
  // [카테고리, 프런트엔드 키, 저장 JSON 필드, 값 없을 때의 기대값]
  ['features', 'board_enabled', 'enabled', true],
  ['features', 'artist_registration_enabled', 'registration_enabled', true],
  ['features', 'comments_enabled', 'enabled', true],
  ['features', 'file_uploads_enabled', 'enabled', true],
]

for (const [category, frontendKey, jsonField, absentExpected] of DISPLAY_CASES) {
  test(`화면 표시 ${category}.${frontendKey}: 저장 true/false/없음을 그대로 말한다`, () => {
    const { transform } = SETTING_MAPPINGS[category][frontendKey]

    assert.equal(transform({ [jsonField]: true }), true)
    assert.equal(
      transform({ [jsonField]: false }),
      false,
      '관리자가 끈 값이 화면에서 켜진 것으로 보이면 안 된다'
    )
    assert.equal(transform({}), absentExpected, '값이 없을 때는 소비처의 판정과 같아야 한다')
    assert.equal(transform(null), absentExpected)
    assert.equal(transform(undefined), absentExpected)
  })
}

test('화면 표시: 펀딩만 값이 없을 때 꺼진 쪽으로 기운다(소비처가 그렇게 읽는다)', () => {
  const { transform } = SETTING_MAPPINGS.features.funding_enabled
  assert.equal(transform({ enabled: true }), true)
  assert.equal(transform({ enabled: false }), false)
  assert.equal(transform({}), false)
})

test('화면 표시: 이메일 인증 관문은 새 칸만 읽고, 운영에 남은 옛 값에 속지 않는다', () => {
  const { transform } = SETTING_MAPPINGS.security.require_email_verification

  assert.equal(transform({ enforce_on_login: true }), true)
  assert.equal(transform({ enforce_on_login: false }), false)
  assert.equal(transform({}), false)
  assert.equal(transform(null), false)
  assert.equal(transform(undefined), false)

  // 운영 행의 오늘 모양. 이 칸을 읽었다면 배포하는 순간 화면이 "켜짐"으로
  // 떠서, 사무국이 아무것도 하지 않았는데 미인증 회원이 막혔을 것이다.
  assert.equal(
    transform({ required: true, token_expiry_hours: 24, resend_limit: 3 }),
    false,
    '아무도 읽지 않던 옛 값이 관문을 켜면 안 된다'
  )
})

const WRITE_CASES = [
  // [builder, 저장 JSON 필드, 다른 인자, 값 없을 때의 기대값]
  [buildRegistrationEnabledValue, 'require_approval', true, true],
  [buildSessionConfigValue, 'require_reauth_for_sensitive', 120, true],
  [buildLoginPolicyValue, 'require_strong_password', 5, true],
  [buildPasswordPolicyValue, 'require_uppercase', 8, true],
  [buildPasswordPolicyValue, 'require_lowercase', 8, true],
  [buildPasswordPolicyValue, 'require_numbers', 8, true],
]

for (const [build, jsonField, otherArg, absentExpected] of WRITE_CASES) {
  test(`저장 ${build.name} → ${jsonField}: 저장 true/false/없음을 그대로 다시 쓴다`, () => {
    assert.equal(build({ [jsonField]: true }, otherArg)[jsonField], true)
    assert.equal(
      build({ [jsonField]: false }, otherArg)[jsonField],
      false,
      '끈 값이 같은 그룹의 다른 항목을 저장할 때 되살아나면 안 된다'
    )
    assert.equal(build({}, otherArg)[jsonField], absentExpected)
    assert.equal(build(undefined, otherArg)[jsonField], absentExpected)
  })
}

test('저장: 화면이 보낸 필드는 씨앗값이 아니라 보낸 값으로 저장된다', () => {
  assert.equal(buildRegistrationEnabledValue({ enabled: true }, false).enabled, false)
  assert.equal(buildSessionConfigValue({ timeout_minutes: 480 }, 30).timeout_minutes, 30)
  assert.equal(buildLoginPolicyValue({ max_attempts: 5 }, 3).max_attempts, 3)
  assert.equal(buildPasswordPolicyValue({ min_length: 8 }, 12).min_length, 12)
})

test('저장: 열두 자리 밖의 형제 필드는 저장값 그대로 남는다', () => {
  const session = buildSessionConfigValue({ max_concurrent_sessions: 2 }, 60)
  assert.equal(session.max_concurrent_sessions, 2)

  const login = buildLoginPolicyValue({ lockout_duration_minutes: 45 }, 5)
  assert.equal(login.lockout_duration_minutes, 45)

  // require_special은 기본값이 false라 `||`로도 뒤집히지 않았다 — 그래도
  // 저장된 true가 보존되는지는 못박아 둔다.
  const password = buildPasswordPolicyValue({ require_special: true, history_count: 9 }, 8)
  assert.equal(password.require_special, true)
  assert.equal(password.history_count, 9)
  assert.equal(buildPasswordPolicyValue({}, 8).require_special, false)
})

test('부정 대조: 옛 `||` 관용구였다면 저장된 false가 전부 true로 되살아난다', () => {
  // 고치기 전 코드가 무엇을 했는지 이 자리에 남겨 둔다.
  const oldIdiom = stored => stored?.require_uppercase || true
  assert.equal(oldIdiom({ require_uppercase: false }), true)
  assert.equal(buildPasswordPolicyValue({ require_uppercase: false }, 8).require_uppercase, false)
})
