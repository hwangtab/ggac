import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SETTING_MAPPINGS,
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
