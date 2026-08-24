import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  toArtistRow,
  toUserRow,
  toAccountRow,
  toMemberProfileRow,
} from '../migrate/lib/identityMapping.mjs'

const PG_PROFILE = {
  id: 'u1',
  display_name: '홍길동',
  email: 'a@x.kr',
  phone_number: '010-0000-0000',
  birth_date: '1990-01-01',
  real_name: '홍길동',
  monthly_fee: 30000,
  bank_name: '국민',
  account_number: '123-456',
  account_holder: '홍길동',
  registration_status: 'approved',
  is_active: true,
  is_admin: true,
  created_at: '2025-10-15T16:42:41.104671+00:00',
  updated_at: '2025-10-16T00:00:00+00:00',
  approved_at: '2025-10-16T00:00:00+00:00',
  approved_by: 'admin1',
  last_login_at: null,
  rejected_by: null,
  suspension_reason: null,
  suspension_until: null,
  is_suspended: false,
  profile_completeness_score: 80,
  verification_status: { email: true, phone: false, identity: false },
  membership_type: 'regular',
  engagement_score: 3,
  is_member: true,
  artist_id: 'artist-014',
  is_artist: true,
  artist_role: 'owner',
  is_director: false,
  director_title: null,
  is_auditor: false,
}

const AUTH_USER = {
  id: 'u1',
  email: 'a@x.kr',
  encrypted_password: '$2a$10$01234567890123456789012345678901234567890123456789012',
  email_confirmed_at: '2025-10-15 16:42:41.104557+00',
  created_at: '2025-10-15 16:42:41.104557+00',
  updated_at: '2025-10-16 00:00:00+00',
}

const PG_ARTIST = {
  id: 'a-uuid',
  legacy_id: 'artist-014',
  slug: 'hwang',
  name: '홍길동',
  category: ['음악'],
  one_liner: '한 줄',
  bio: '소개',
  template_type: '콜라주형',
  portfolio_links: null,
  youtube_videos: [],
  contact: null,
  created_at: '2025-10-15T16:42:41.104671+00:00',
  updated_at: '2025-10-16T00:00:00+00:00',
  profile_photo_url: null,
  profile_photo_metadata: { w: 1 },
  is_active: true,
  name_en: null,
  one_liner_en: null,
  bio_en: null,
  template_type_en: null,
}

test('조합원 프로필은 33개 컬럼을 전부 낸다', () => {
  assert.equal(Object.keys(toMemberProfileRow(PG_PROFILE)).length, 33)
})

test('가입 폼 7개 필드를 그대로 옮긴다', () => {
  const row = toMemberProfileRow(PG_PROFILE)
  assert.equal(row.real_name, '홍길동')
  assert.equal(row.phone_number, '010-0000-0000')
  assert.equal(row.birth_date, '1990-01-01')
  assert.equal(row.monthly_fee, 30000)
  assert.equal(row.bank_name, '국민')
  assert.equal(row.account_number, '123-456')
  assert.equal(row.account_holder, '홍길동')
})

test('생년월일은 문자열 그대로 둔다 (타임존 해석 금지)', () => {
  assert.equal(typeof toMemberProfileRow(PG_PROFILE).birth_date, 'string')
})

test('불리언은 0/1 정수로 바꾼다', () => {
  const row = toMemberProfileRow(PG_PROFILE)
  assert.equal(row.is_active, 1)
  assert.equal(row.is_suspended, 0)
})

test('JSON 컬럼은 문자열로 직렬화한다', () => {
  assert.equal(
    toMemberProfileRow(PG_PROFILE).verification_status,
    '{"email":true,"phone":false,"identity":false}'
  )
})

test('타임스탬프는 밀리초 정수가 된다', () => {
  const row = toMemberProfileRow(PG_PROFILE)
  assert.equal(typeof row.created_at, 'number')
  assert.equal(row.last_login_at, null)
})

test('artist_id는 legacy_id 문자열을 원문 그대로 옮긴다', () => {
  assert.equal(toMemberProfileRow(PG_PROFILE).artist_id, 'artist-014')
})

test('아티스트는 20개 컬럼을 전부 낸다', () => {
  assert.equal(Object.keys(toArtistRow(PG_ARTIST)).length, 20)
})

test('portfolio_links의 NULL은 빈 배열로 정규화한다', () => {
  // Turso 스키마가 notNull().default([])라 NULL을 그대로 넣으면 INSERT가 실패한다.
  assert.equal(toArtistRow(PG_ARTIST).portfolio_links, '[]')
  assert.equal(toArtistRow(PG_ARTIST).youtube_videos, '[]')
})

test('사용자 행은 7개 컬럼이고 이름은 표시명에서 온다', () => {
  const row = toUserRow(PG_PROFILE, AUTH_USER)
  assert.equal(Object.keys(row).length, 7)
  assert.equal(row.id, 'u1')
  assert.equal(row.name, '홍길동')
  assert.equal(row.email_verified, 1)
  assert.equal(row.image, null)
})

test('이메일 미확인 사용자는 email_verified가 0이다', () => {
  const row = toUserRow(PG_PROFILE, { ...AUTH_USER, email_confirmed_at: null })
  assert.equal(row.email_verified, 0)
})

test('계정 행은 credential 제공자로 bcrypt 해시를 담는다', () => {
  const row = toAccountRow(AUTH_USER)
  assert.equal(Object.keys(row).length, 7)
  assert.equal(row.provider_id, 'credential')
  assert.equal(row.user_id, 'u1')
  assert.equal(row.account_id, 'u1')
  assert.equal(row.id, 'u1')
  assert.equal(row.password, AUTH_USER.encrypted_password)
})

test('bcrypt가 아닌 해시는 던진다', () => {
  assert.throws(
    () => toAccountRow({ ...AUTH_USER, encrypted_password: 'scrypt:16384:8:1:aa:bb' }),
    /bcrypt/
  )
})

test('해시가 비면 던진다', () => {
  assert.throws(() => toAccountRow({ ...AUTH_USER, encrypted_password: null }), /bcrypt/)
})
