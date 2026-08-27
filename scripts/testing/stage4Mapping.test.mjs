import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

import {
  toBoardMeetingRow,
  toBoardAgendaRow,
  toBoardMinuteRow,
  toBoardDocumentRow,
  toBoardMeetingAttendeeRow,
  toBoardMeetingDateOptionRow,
  toBoardMeetingDateVoteRow,
  toSystemSettingRow,
  toSystemSettingsHistoryRow,
  toDefaultSettingRow,
  toUserSettingRow,
  toUserActivityRow,
  toUserSessionRow,
  toDailyActivityStatRow,
  toLinkPreviewRow,
  toEventApplicationRow,
  toMemberBulkOperationRow,
  toJsonTextOrNull,
} from '../migrate/lib/stage4Mapping.mjs'
import { toArtistRow, toMemberProfileRow } from '../migrate/lib/identityMapping.mjs'
import { parseInsertRows } from '../migrate/lib/pgDumpParser.mjs'
import { buildUpsert as identityBuildUpsert } from '../migrate/identity.mjs'
import { parseExpect, evaluateExpectGate } from '../migrate/content.mjs'
import {
  LOAD_ORDER,
  REFERENCE_CHECKS,
  findOrphans,
  parseNullOrphanFk,
  validateNullOrphanFk,
  resolveOrphans,
  assertDumpColumnsCovered,
  buildUpsert,
  loadStage4,
  verifyStage4,
} from '../migrate/stage4.mjs'

// ---------------------------------------------------------------- 픽스처
// pg_dump가 실제로 내는 형식(공백 구분 타임스탬프, 문자열 boolean)을 그대로
// 흉내낸다. 값은 전부 합성이다 — 이 파일은 공개 저장소에 커밋된다.

const PG_ARTIST = {
  id: 'a-uuid',
  legacy_id: 'artist-099',
  slug: 'test-artist',
  name: '테스트',
  // Postgres text[] 컬럼 — pg_dump가 실제로 내는 배열 리터럴 문자열
  // 형태(`{연극,연출}`)다. `['미술']`처럼 진짜 배열로 써두면
  // pgArrayToJsonText가 실제로 배열 리터럴을 파싱하는 경로를 통과하지
  // 못한 채 테스트가 통과해버린다(코드리뷰 Important 1 지적 — 정확히
  // 이 픽스처가 원인이었다).
  category: '{연극,연출}',
  one_liner: '한 줄',
  bio: '소개',
  template_type: '콜라주형',
  portfolio_links: null,
  youtube_videos: [],
  contact: null,
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
  profile_photo_url: null,
  profile_photo_metadata: {},
  is_active: 'true',
  name_en: null,
  one_liner_en: null,
  bio_en: null,
  template_type_en: null,
}

const PG_BOARD_MEETING = {
  id: 'bm1',
  title: '정기 이사회',
  meeting_date: '2026-03-01',
  location: '온라인',
  status: 'scheduled',
  vote_deadline: null,
  created_by: 'u1',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
}

const PG_BOARD_AGENDA = {
  id: 'ba1',
  meeting_id: 'bm1',
  title: '안건 1',
  content: '내용',
  sort_order: '1',
  status: 'proposed',
  proposed_by: 'u1',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
}

const PG_BOARD_MINUTE = {
  id: 'bmn1',
  meeting_id: 'bm1',
  content: '회의록',
  content_format: 'plain',
  author_id: null,
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
}

const PG_BOARD_DOCUMENT = {
  id: 'bd1',
  title: '문서',
  category: '정관',
  file_path: 'docs/x.pdf',
  file_name: 'x.pdf',
  file_size: '1024',
  mime_type: 'application/pdf',
  uploaded_by: null,
  created_at: '2026-01-01 00:00:00+00',
}

const PG_BOARD_MEETING_ATTENDEE = {
  id: 'bat1',
  meeting_id: 'bm1',
  member_id: 'u1',
  attended: 'true',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
}

const PG_BOARD_MEETING_DATE_OPTION = {
  id: 'bdo1',
  meeting_id: 'bm1',
  candidate_date: '2026-03-01',
}

const PG_BOARD_MEETING_DATE_VOTE = {
  id: 'bdv1',
  option_id: 'bdo1',
  voter_id: 'u1',
  is_available: 'true',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
}

const PG_SYSTEM_SETTING = {
  id: 'ss1',
  category: 'site',
  setting_key: 'maintenance_mode',
  setting_value: '{"enabled": false}',
  description: '유지보수 모드',
  is_sensitive: 'false',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
  updated_by: null,
}

const PG_SYSTEM_SETTINGS_HISTORY = {
  id: 'ssh1',
  setting_id: 'ss1',
  category: 'site',
  setting_key: 'maintenance_mode',
  old_value: '{"enabled": false}',
  new_value: '{"enabled": true}',
  changed_by: null,
  changed_at: '2026-01-01 00:00:00+00',
  change_reason: null,
}

const PG_DEFAULT_SETTING = {
  id: 'ds1',
  category: 'notification',
  setting_key: 'email_notifications',
  default_value: '{"enabled": true}',
  description: '이메일 알림',
  is_required: 'true',
  created_at: '2026-01-01 00:00:00+00',
}

const PG_USER_SETTING = {
  id: 'us1',
  user_id: 'u1',
  category: 'interface',
  setting_key: 'theme',
  setting_value: '{"mode": "light"}',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
}

const PG_USER_ACTIVITY = {
  id: 'ua1',
  user_id: 'u1',
  action_type: 'login',
  target_type: null,
  target_id: null,
  metadata: null,
  ip_address: '127.0.0.1',
  user_agent: 'test-agent',
  session_id: null,
  created_at: '2026-01-01 00:00:00+00',
}

const PG_USER_SESSION = {
  id: 'usess1',
  user_id: 'u1',
  session_token: 'tok-1',
  last_activity: '2026-01-01 00:00:00+00',
  is_active: 'true',
  ip_address: '127.0.0.1',
  user_agent: 'test-agent',
  login_at: '2026-01-01 00:00:00+00',
  logout_at: null,
  metadata: '{"screen": "1920x1080"}',
}

const PG_DAILY_ACTIVITY_STAT = {
  id: 'das1',
  activity_date: '2026-01-01',
  user_id: 'u1',
  action_type: 'login',
  count: '3',
  last_updated: '2026-01-01 00:00:00+00',
}

const PG_LINK_PREVIEW = {
  url: 'https://example.com/x',
  data: '{"title": "x"}',
  last_fetched: '2026-01-01 00:00:00+00',
  ttl_seconds: '21600',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
}

const PG_EVENT_APPLICATION = {
  id: 'ea1',
  event_slug: 'test-event',
  applicant_name: '홍길동',
  contact_email: 'a@x.kr',
  contact_phone: '010-0000-0000',
  performance_info: null,
  items_to_sell: null,
  links: null,
  message: null,
  status: 'pending',
  created_at: '2026-01-01 00:00:00+00',
  updated_at: '2026-01-01 00:00:00+00',
  privacy_consent: 'true',
  privacy_consent_at: '2026-01-01 00:00:00+00',
  participation_type: 'performer',
  photo_url: null,
}

const PG_MEMBER_BULK_OPERATION = {
  id: 'mbo1',
  operation_type: 'bulk_approve',
  performed_by: 'u1',
  // uuid[] 컬럼 — pg_dump가 실제로 내는 배열 리터럴 형태(JSON 배열
  // 문자열이 아니다). 이 픽스처를 JSON처럼 써두면 pgArrayToJsonText가
  // 실제로 배열 리터럴을 파싱하는지 검증하지 못한다.
  member_ids: '{u1,u2}',
  parameters: null,
  results: null,
  status: 'pending',
  created_at: '2026-01-01 00:00:00+00',
  started_at: null,
  completed_at: null,
  error_message: null,
}

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
  is_admin: false,
  created_at: '2025-10-15T16:42:41.104671+00:00',
  updated_at: '2025-10-16T00:00:00+00:00',
  approved_at: null,
  approved_by: null,
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
  artist_id: null,
  is_artist: false,
  artist_role: 'owner',
  is_director: false,
  director_title: null,
  is_auditor: false,
}

// ---------------------------------------------------------------- 매퍼 단위 테스트

test('toJsonTextOrNull: null은 null로 보존하고 값은 직렬화한다', () => {
  assert.equal(toJsonTextOrNull(null), null)
  assert.equal(toJsonTextOrNull(undefined), null)
  assert.equal(toJsonTextOrNull({ a: 1 }), '{"a":1}')
  assert.equal(toJsonTextOrNull('{"a":1}'), '{"a":1}')
})

test('toBoardMeetingRow: 10개 컬럼을 낸다, 날짜 전용 컬럼은 문자열 그대로', () => {
  const row = toBoardMeetingRow(PG_BOARD_MEETING)
  assert.equal(Object.keys(row).length, 10)
  assert.equal(row.meeting_date, '2026-03-01')
  assert.equal(typeof row.created_at, 'number')
  // `meeting_time`은 컷오버 이후 추가된 컬럼(0007)이라 Supabase 원본에 없다.
  // 매퍼가 명시적으로 null을 낸다 — 생략하면 커버리지 게이트가 막는다.
  assert.equal(row.meeting_time, null)
  assert.ok('meeting_time' in row, '키 자체가 있어야 커버리지 게이트를 통과한다')
})

test('toBoardAgendaRow: 9개 컬럼, sort_order는 정수로 바뀐다', () => {
  const row = toBoardAgendaRow(PG_BOARD_AGENDA)
  assert.equal(Object.keys(row).length, 9)
  assert.equal(row.sort_order, 1)
})

test('toBoardAgendaRow: sort_order가 없으면 0으로 기본값', () => {
  const row = toBoardAgendaRow({ ...PG_BOARD_AGENDA, sort_order: null })
  assert.equal(row.sort_order, 0)
})

test('toBoardMinuteRow: 7개 컬럼, author_id null 허용', () => {
  const row = toBoardMinuteRow(PG_BOARD_MINUTE)
  assert.equal(Object.keys(row).length, 7)
  assert.equal(row.author_id, null)
})

test('toBoardDocumentRow: 9개 컬럼, file_size는 정수로 바뀐다', () => {
  const row = toBoardDocumentRow(PG_BOARD_DOCUMENT)
  assert.equal(Object.keys(row).length, 9)
  assert.equal(row.file_size, 1024)
})

test('toBoardMeetingAttendeeRow: 6개 컬럼, attended는 0/1로 바뀐다', () => {
  const row = toBoardMeetingAttendeeRow(PG_BOARD_MEETING_ATTENDEE)
  assert.equal(Object.keys(row).length, 6)
  assert.equal(row.attended, 1)
})

test('toBoardMeetingDateOptionRow / toBoardMeetingDateVoteRow: 컬럼 수', () => {
  assert.equal(Object.keys(toBoardMeetingDateOptionRow(PG_BOARD_MEETING_DATE_OPTION)).length, 3)
  const vote = toBoardMeetingDateVoteRow(PG_BOARD_MEETING_DATE_VOTE)
  assert.equal(Object.keys(vote).length, 6)
  assert.equal(vote.is_available, 1)
})

test('toSystemSettingRow: 9개 컬럼, setting_value는 문자열로 직렬화한다', () => {
  const row = toSystemSettingRow(PG_SYSTEM_SETTING)
  assert.equal(Object.keys(row).length, 9)
  assert.equal(typeof row.setting_value, 'string')
  assert.equal(row.is_sensitive, 0)
})

test('toSystemSettingsHistoryRow: 9개 컬럼, old_value/new_value는 null을 보존한다', () => {
  const row = toSystemSettingsHistoryRow(PG_SYSTEM_SETTINGS_HISTORY)
  assert.equal(Object.keys(row).length, 9)
  assert.equal(row.changed_by, null)
  const nulled = toSystemSettingsHistoryRow({ ...PG_SYSTEM_SETTINGS_HISTORY, old_value: null })
  assert.equal(nulled.old_value, null)
})

test('toDefaultSettingRow: 7개 컬럼', () => {
  const row = toDefaultSettingRow(PG_DEFAULT_SETTING)
  assert.equal(Object.keys(row).length, 7)
  assert.equal(row.is_required, 1)
})

test('toUserSettingRow: 7개 컬럼', () => {
  assert.equal(Object.keys(toUserSettingRow(PG_USER_SETTING)).length, 7)
})

test('toUserActivityRow: 10개 컬럼, metadata가 비면 빈 객체 문자열', () => {
  const row = toUserActivityRow(PG_USER_ACTIVITY)
  assert.equal(Object.keys(row).length, 10)
  assert.equal(row.metadata, '{}')
})

test('toUserSessionRow: 10개 컬럼, is_active는 0/1로 바뀐다', () => {
  const row = toUserSessionRow(PG_USER_SESSION)
  assert.equal(Object.keys(row).length, 10)
  assert.equal(row.is_active, 1)
  assert.equal(row.logout_at, null)
})

test('toDailyActivityStatRow: 6개 컬럼, activity_date는 문자열 그대로', () => {
  const row = toDailyActivityStatRow(PG_DAILY_ACTIVITY_STAT)
  assert.equal(Object.keys(row).length, 6)
  assert.equal(row.activity_date, '2026-01-01')
  assert.equal(row.count, 3)
})

test('toLinkPreviewRow: 6개 컬럼, PK는 url이다', () => {
  const row = toLinkPreviewRow(PG_LINK_PREVIEW)
  assert.equal(Object.keys(row).length, 6)
  assert.equal(row.url, 'https://example.com/x')
  assert.equal(row.ttl_seconds, 21600)
})

test('toEventApplicationRow: 16개 컬럼, privacy_consent는 0/1로 바뀐다', () => {
  const row = toEventApplicationRow(PG_EVENT_APPLICATION)
  assert.equal(Object.keys(row).length, 16)
  assert.equal(row.privacy_consent, 1)
})

test('toMemberBulkOperationRow: 11개 컬럼, jsonb는 fallback을 쓴다', () => {
  const row = toMemberBulkOperationRow(PG_MEMBER_BULK_OPERATION)
  assert.equal(Object.keys(row).length, 11)
  assert.equal(row.parameters, '{}')
  assert.equal(row.results, '{}')
  assert.equal(typeof row.member_ids, 'string')
})

test('toMemberBulkOperationRow: member_ids(uuid[])는 배열 리터럴을 실제 JSON 배열로 판다', () => {
  // Postgres 배열 리터럴('{u1,u2}')을 JSON 배열 문자열로 바꿔야지, 원문
  // 그대로 저장하면 JSON.parse가 던진다 — Important 1과 같은 함정.
  const row = toMemberBulkOperationRow(PG_MEMBER_BULK_OPERATION)
  assert.deepEqual(JSON.parse(row.member_ids), ['u1', 'u2'])
})

// ---------------------------------------------------------- Postgres 배열 리터럴 (코드리뷰 Important 1)
//
// 리뷰어가 실측으로 확정한 버그: 단계 2b는 artists를 PostgREST로 읽어
// category가 진짜 배열이었지만, 이 스크립트는 pg_dump 텍스트를 읽으므로
// `{연주자,창작자}` 형태의 Postgres 배열 리터럴 문자열이 온다. 예전
// json()은 문자열이면 그대로 통과시켜 이 리터럴이 파싱 불가능한 값으로
// Turso에 그대로 들어갔다 — verifyStage4는 매핑 결과 자체와 대조하므로
// 통과했지만, 실제로 읽는 쪽(Drizzle JSON.parse)이 던져 아티스트 13명
// 전원의 페이지가 죽었을 것이다.

test('toArtistRow: 덤프 형식(text[] 배열 리터럴) category가 실제 JSON 배열이 된다', () => {
  const row = toArtistRow(PG_ARTIST)
  assert.deepEqual(JSON.parse(row.category), ['연극', '연출'])
})

test('부정 대조: category가 파싱 불가능한 배열 리터럴이면 던진다(조용히 원문을 통과시키지 않는다)', () => {
  assert.throws(
    () => toArtistRow({ ...PG_ARTIST, category: '{닫히지 않음' }),
    /Postgres 배열 리터럴 형식이 아니다/
  )
})

test('artists 3행을 실제 덤프와 같은 INSERT 문 형태로 파싱하면 전부 JSON 파싱 가능한 category가 된다', () => {
  // 실제 운영 덤프(13행)를 이 저장소에 커밋할 수는 없으니(개인정보 우려는
  // 없지만 덤프 파일 자체를 저장소에 두지 않는다는 원칙), 형태가 같은
  // 3행짜리 INSERT 블록을 합성한다: 단순 원소, 다중 원소, 쉼표가 포함된
  // 따옴표 원소 — 실제 덤프에서 나올 수 있는 세 가지 패턴을 다 담는다.
  const sql = [
    'INSERT INTO "public"."artists" ("id", "legacy_id", "slug", "name", "category", "one_liner", "bio", "template_type", "portfolio_links", "youtube_videos", "contact", "created_at", "updated_at", "profile_photo_url", "profile_photo_metadata", "is_active", "name_en", "one_liner_en", "bio_en", "template_type_en") VALUES',
    `\t('a1', 'artist-1', 's1', '이름1', '{연주자}', NULL, NULL, NULL, '[]', '[]', NULL, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', NULL, '{}', 'true', NULL, NULL, NULL, NULL),`,
    `\t('a2', 'artist-2', 's2', '이름2', '{연주자,창작자,엔지니어}', NULL, NULL, NULL, '[]', '[]', NULL, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', NULL, '{}', 'true', NULL, NULL, NULL, NULL),`,
    `\t('a3', 'artist-3', 's3', '이름3', '{"기획자,공연",연출}', NULL, NULL, NULL, '[]', '[]', NULL, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', NULL, '{}', 'true', NULL, NULL, NULL, NULL);`,
  ].join('\n')

  const rows = parseInsertRows(sql, 'public', 'artists').map(toArtistRow)
  assert.equal(rows.length, 3)
  const categories = rows.map(r => JSON.parse(r.category))
  assert.deepEqual(categories[0], ['연주자'])
  assert.deepEqual(categories[1], ['연주자', '창작자', '엔지니어'])
  assert.deepEqual(categories[2], ['기획자,공연', '연출'])
})

// ---------------------------------------------------------------- LOAD_ORDER

test('LOAD_ORDER는 REFERENCE_CHECKS가 아는 internal 부모를 자식보다 먼저 적재한다', () => {
  const tableByPayloadKey = Object.fromEntries(LOAD_ORDER.map(([table, key]) => [key, table]))
  const position = Object.fromEntries(LOAD_ORDER.map(([table], i) => [table, i]))

  for (const { key, parentKey, parentSource } of REFERENCE_CHECKS) {
    if (parentSource !== 'internal') continue // 'external'(profiles)은 이 payload 밖이다
    const childTable = tableByPayloadKey[key]
    const parentTable = tableByPayloadKey[parentKey]
    assert.ok(
      position[childTable] > position[parentTable],
      `${childTable}(${position[childTable]})가 부모 ${parentTable}(${position[parentTable]})보다 먼저 오면 안 된다`
    )
  }
})

test('buildUpsert: 기본 pkColumn은 id, link_previews는 url을 쓸 수 있다', () => {
  const { sql: idSql } = buildUpsert('board_meetings', toBoardMeetingRow(PG_BOARD_MEETING))
  assert.match(idSql, /ON CONFLICT\("id"\) DO UPDATE SET/)

  const { sql: urlSql, args } = buildUpsert(
    'link_previews',
    toLinkPreviewRow(PG_LINK_PREVIEW),
    'url'
  )
  assert.match(urlSql, /ON CONFLICT\("url"\) DO UPDATE SET/)
  assert.ok(!urlSql.includes('"url" = excluded."url"'), 'PK 컬럼 자체는 UPDATE SET에 없어야 한다')
  assert.equal(args[0], 'https://example.com/x')
})

// ---------------------------------------------------------------- findOrphans

function emptyPayload() {
  return {
    artists: [],
    boardMeetings: [],
    boardAgendas: [],
    boardMinutes: [],
    boardDocuments: [],
    boardMeetingAttendees: [],
    boardMeetingDateOptions: [],
    boardMeetingDateVotes: [],
    systemSettings: [],
    systemSettingsHistory: [],
    defaultSettings: [],
    userSettings: [],
    userActivities: [],
    userSessions: [],
    dailyActivityStats: [],
    linkPreviews: [],
    eventApplications: [],
    memberBulkOperations: [],
  }
}

test('findOrphans: external 참조(profiles)가 없는 회원을 가리키면 잡는다', () => {
  const payload = emptyPayload()
  payload.userActivities = [toUserActivityRow({ ...PG_USER_ACTIVITY, user_id: 'ghost-user' })]
  const profileIds = new Set(['u1'])

  const orphans = findOrphans(payload, profileIds)
  assert.equal(orphans.length, 1)
  assert.equal(orphans[0].key, 'userActivities')
  assert.equal(orphans[0].column, 'user_id')
  assert.equal(orphans[0].missing, 'ghost-user')
})

test('findOrphans: internal 참조(board_meetings)가 없는 회의를 가리키면 잡는다', () => {
  const payload = emptyPayload()
  payload.boardAgendas = [toBoardAgendaRow({ ...PG_BOARD_AGENDA, meeting_id: 'ghost-meeting' })]
  const profileIds = new Set(['u1'])

  const orphans = findOrphans(payload, profileIds)
  assert.equal(orphans.length, 1)
  assert.equal(orphans[0].key, 'boardAgendas')
  assert.equal(orphans[0].column, 'meeting_id')
})

test('findOrphans: null FK는 고아로 취급하지 않는다', () => {
  const payload = emptyPayload()
  // meeting_id(NOT NULL)는 유효한 부모를 같이 넣어 격리하고, author_id(nullable)만 본다.
  payload.boardMeetings = [toBoardMeetingRow(PG_BOARD_MEETING)]
  payload.boardMinutes = [toBoardMinuteRow(PG_BOARD_MINUTE)] // author_id: null
  const profileIds = new Set(['u1'])
  assert.deepEqual(findOrphans(payload, profileIds), [])
})

test('findOrphans: 고아가 없으면 빈 배열이다', () => {
  const payload = emptyPayload()
  payload.boardMeetings = [toBoardMeetingRow(PG_BOARD_MEETING)]
  payload.boardAgendas = [toBoardAgendaRow(PG_BOARD_AGENDA)]
  const profileIds = new Set(['u1'])
  assert.deepEqual(findOrphans(payload, profileIds), [])
})

// -------------------------------------------------- --null-orphan-fk (코드리뷰 Important 4)

test('parseNullOrphanFk: 플래그가 없으면 빈 Set이다(기본값 = 무조건 중단)', () => {
  assert.deepEqual(parseNullOrphanFk(['--dump', 'x.sql']), new Set())
})

test('parseNullOrphanFk: table.column,table.column 형식을 파싱한다', () => {
  const result = parseNullOrphanFk([
    '--null-orphan-fk',
    'user_activities.user_id,user_sessions.user_id',
  ])
  assert.deepEqual(result, new Set(['user_activities.user_id', 'user_sessions.user_id']))
})

test('parseNullOrphanFk: 값이 없거나 다음 플래그를 삼키면 던진다', () => {
  assert.throws(() => parseNullOrphanFk(['--null-orphan-fk']), /usage/)
  assert.throws(() => parseNullOrphanFk(['--null-orphan-fk', '--apply']), /usage/)
})

test('validateNullOrphanFk: 모르는 표.컬럼이면 던진다', () => {
  assert.throws(
    () => validateNullOrphanFk(new Set(['no_such_table.no_such_column'])),
    /알 수 없는 표\.컬럼/
  )
})

test('부정 대조: NOT NULL 컬럼(board_meeting_attendees.member_id)에 --null-orphan-fk를 쓰면 거부된다', () => {
  assert.throws(
    () => validateNullOrphanFk(new Set(['board_meeting_attendees.member_id'])),
    /NOT NULL 컬럼이라 쓸 수 없다/
  )
})

test('validateNullOrphanFk: nullable 컬럼(user_activities.user_id)은 통과한다', () => {
  assert.doesNotThrow(() => validateNullOrphanFk(new Set(['user_activities.user_id'])))
})

test('resolveOrphans: 지정 밖의 고아는 disallowed로 돌려주고 중단해야 함을 알린다', () => {
  const payload = emptyPayload()
  payload.userActivities = [toUserActivityRow({ ...PG_USER_ACTIVITY, user_id: 'ghost' })]
  const orphans = findOrphans(payload, new Set(['u1']))

  const result = resolveOrphans(payload, orphans, new Set()) // 기본값: 빈 Set
  assert.equal(result.ok, false)
  assert.equal(result.disallowed.length, 1)
})

test('resolveOrphans: 지정된 nullable FK는 행을 지우지 않고 그 컬럼만 null로 낮춘다', () => {
  const payload = emptyPayload()
  payload.userActivities = [
    toUserActivityRow({ ...PG_USER_ACTIVITY, id: 'ua-ghost', user_id: 'ghost' }),
  ]
  const orphans = findOrphans(payload, new Set(['u1']))

  const result = resolveOrphans(payload, orphans, new Set(['user_activities.user_id']))
  assert.equal(result.ok, true)
  assert.equal(result.payload.userActivities.length, 1, '행 자체는 지워지지 않는다')
  assert.equal(result.payload.userActivities[0].id, 'ua-ghost')
  assert.equal(result.payload.userActivities[0].user_id, null, 'FK 컬럼만 null로 낮춘다')
  assert.deepEqual(result.nulledCounts, { 'user_activities.user_id': 1 })
})

test('resolveOrphans: 고아가 없으면 payload를 그대로 통과시킨다', () => {
  const payload = emptyPayload()
  const result = resolveOrphans(payload, [], new Set())
  assert.equal(result.ok, true)
  assert.equal(result.payload, payload)
  assert.deepEqual(result.nulledCounts, {})
})

// -------------------------------------------------- assertDumpColumnsCovered (코드리뷰 Important 3)

test('assertDumpColumnsCovered: 덤프 컬럼이 매퍼 키에 다 있으면 통과한다', () => {
  const row = toBoardMeetingRow(PG_BOARD_MEETING)
  assert.doesNotThrow(() =>
    assertDumpColumnsCovered('board_meetings', Object.keys(PG_BOARD_MEETING), [row])
  )
})

test('부정 대조: 매퍼가 덤프에 있는 컬럼을 빠뜨리면 중단시킨다', () => {
  const row = toBoardMeetingRow(PG_BOARD_MEETING)
  delete row.status // 매퍼가 실수로 빠뜨렸다고 가정(운영 매퍼는 안 건드림)
  const dumpCols = [...Object.keys(PG_BOARD_MEETING), 'brand_new_column_pg_has']
  assert.throws(
    () => assertDumpColumnsCovered('board_meetings', dumpCols, [row]),
    /Postgres 덤프에는 있는데 매퍼가 빠뜨린 컬럼/
  )
})

test('assertDumpColumnsCovered: 덤프에 그 표의 INSERT가 없으면(null) 검사를 건너뛴다', () => {
  assert.doesNotThrow(() => assertDumpColumnsCovered('user_settings', null, []))
})

// ---------------------------------------------------------------- evaluateExpectGate(stage4 표 집합)

const ALL_18_COUNTS = Object.fromEntries(LOAD_ORDER.map(([table], i) => [table, i]))

test('evaluateExpectGate: --apply인데 표 하나만 덮은 --expect는 incomplete_expect (부정 대조)', () => {
  const [firstTable] = LOAD_ORDER[0]
  const result = evaluateExpectGate({
    expect: { [firstTable]: ALL_18_COUNTS[firstTable] },
    apply: true,
    parsedCounts: ALL_18_COUNTS,
  })
  assert.equal(result.status, 'incomplete_expect')
  assert.equal(result.missingTables.length, LOAD_ORDER.length - 1)
})

test('evaluateExpectGate: 18개 표를 전부 덮으면 matched다', () => {
  const result = evaluateExpectGate({
    expect: { ...ALL_18_COUNTS },
    apply: true,
    parsedCounts: ALL_18_COUNTS,
  })
  assert.equal(result.status, 'matched')
})

test('evaluateExpectGate: dry-run은 표 하나만 덮은 --expect도 허용한다', () => {
  const [firstTable] = LOAD_ORDER[0]
  const result = evaluateExpectGate({
    expect: { [firstTable]: ALL_18_COUNTS[firstTable] },
    apply: false,
    parsedCounts: ALL_18_COUNTS,
  })
  assert.equal(result.status, 'matched')
})

test('parseExpect: stage4 표 이름을 그대로 파싱한다', () => {
  assert.deepEqual(parseExpect(['--expect', 'artists=13,board_meetings=12']), {
    artists: 13,
    board_meetings: 12,
  })
})

// ---------------------------------------------------------------- 로더 통합(파일 DB)

const DB_PATH = 'scripts/testing/.stage4-loader-test.db'
let client

function payload() {
  return {
    artists: [toArtistRow(PG_ARTIST)],
    boardMeetings: [toBoardMeetingRow(PG_BOARD_MEETING)],
    boardAgendas: [toBoardAgendaRow(PG_BOARD_AGENDA)],
    boardMinutes: [toBoardMinuteRow(PG_BOARD_MINUTE)],
    boardDocuments: [toBoardDocumentRow(PG_BOARD_DOCUMENT)],
    boardMeetingAttendees: [toBoardMeetingAttendeeRow(PG_BOARD_MEETING_ATTENDEE)],
    boardMeetingDateOptions: [toBoardMeetingDateOptionRow(PG_BOARD_MEETING_DATE_OPTION)],
    boardMeetingDateVotes: [toBoardMeetingDateVoteRow(PG_BOARD_MEETING_DATE_VOTE)],
    systemSettings: [toSystemSettingRow(PG_SYSTEM_SETTING)],
    systemSettingsHistory: [toSystemSettingsHistoryRow(PG_SYSTEM_SETTINGS_HISTORY)],
    defaultSettings: [toDefaultSettingRow(PG_DEFAULT_SETTING)],
    userSettings: [toUserSettingRow(PG_USER_SETTING)],
    userActivities: [toUserActivityRow(PG_USER_ACTIVITY)],
    userSessions: [toUserSessionRow(PG_USER_SESSION)],
    dailyActivityStats: [toDailyActivityStatRow(PG_DAILY_ACTIVITY_STAT)],
    linkPreviews: [toLinkPreviewRow(PG_LINK_PREVIEW)],
    eventApplications: [toEventApplicationRow(PG_EVENT_APPLICATION)],
    memberBulkOperations: [], // performed_by NOT NULL이라 u1 하나로는 FK 순환 없이 넣기 애매해 비워둔다
  }
}

before(async () => {
  rmSync(DB_PATH, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  // member_profiles는 이 스크립트가 적재하지 않는 external 참조 대상이라
  // identity.mjs의 buildUpsert로 직접 심는다(단계 2c의 실제 로더와 같은 경로).
  await client.execute(identityBuildUpsert('member_profiles', toMemberProfileRow(PG_PROFILE)))
})

after(() => {
  client?.close()
  rmSync(DB_PATH, { force: true })
})

test('적재하면 17개 표가 채워진다(member_bulk_operations는 이 픽스처에서 0)', async () => {
  const counts = await loadStage4({ client, ...payload() })
  assert.equal(counts.artists, 1)
  assert.equal(counts.board_meetings, 1)
  assert.equal(counts.system_settings_history, 1)
  assert.equal(counts.member_bulk_operations, 0)
})

test('두 번 적재해도 행이 늘지 않는다 (멱등)', async () => {
  await loadStage4({ client, ...payload() })
  const r = await client.execute('select count(*) c from board_meetings')
  assert.equal(r.rows[0].c, 1)
})

test('검증은 불일치 0을 낸다', async () => {
  const { mismatches } = await verifyStage4({ client, expected: payload() })
  assert.deepEqual(mismatches, [])
})

test('link_previews는 url을 PK로 검증한다', async () => {
  await client.execute(
    "update link_previews set ttl_seconds = 1 where url = 'https://example.com/x'"
  )
  const { mismatches } = await verifyStage4({ client, expected: payload() })
  assert.ok(mismatches.some(m => /link_previews url=https:\/\/example\.com\/x ttl_seconds/.test(m)))
  await client.execute(
    "update link_previews set ttl_seconds = 21600 where url = 'https://example.com/x'"
  )
})

// -------------------------------------------------- 청크 적재·페이지 검증 (코드리뷰 Important 2)
//
// user_activities 11,083행을 단일 client.batch()로 던지면 12MB짜리 HTTP
// 요청 하나가 된다 — WRITE_CHUNK_SIZE(500)로 나눠 여러 번의 client.batch()로
// 보내고, verifyStage4도 SELECT_PAGE_SIZE(1000)로 나눠 읽는다. 여기서는
// 두 경계를 모두 넘는 1500행으로 실제 왕복이 맞는지 확인한다(정확한 청크
// 크기를 픽스처가 알 필요는 없다 — "여러 청크/페이지에 걸쳐도 전부
// 맞는다"만 검증하면 된다).

test('대용량 표(1500행)를 적재·검증해도 청크 경계에서 행이 새지 않는다', async () => {
  const bulkActivities = Array.from({ length: 1500 }, (_, i) =>
    toUserActivityRow({ ...PG_USER_ACTIVITY, id: `bulk-ua-${i}`, user_id: 'u1' })
  )
  const basePayload = payload() // user_activities에 ua1이 이미 이전 테스트로 적재돼 있다

  const counts = await loadStage4({
    client,
    ...basePayload,
    userActivities: bulkActivities, // ua1은 이미 있으니 새 1500행만 넘긴다
  })
  assert.equal(counts.user_activities, 1500)

  const bulkCount = await client.execute(
    "select count(*) c from user_activities where id like 'bulk-ua-%'"
  )
  assert.equal(bulkCount.rows[0].c, 1500)

  // 검증은 실제 Turso 상태(ua1 + 새 1500행)와 정확히 맞아야 한다.
  const { mismatches } = await verifyStage4({
    client,
    expected: {
      ...basePayload,
      userActivities: [...basePayload.userActivities, ...bulkActivities],
    },
  })
  assert.deepEqual(mismatches, [])

  // 정리 — 이후 다른 테스트의 count(*) 기반 검증에 영향을 주지 않는다.
  await client.execute("delete from user_activities where id like 'bulk-ua-%'")
})

test('개인정보 컬럼(event_applications)이 어긋나도 값은 절대 찍지 않는다', async () => {
  await client.execute(
    "update event_applications set contact_email = 'leaked@evil.example' where id = 'ea1'"
  )
  const { mismatches } = await verifyStage4({ client, expected: payload() })
  const hit = mismatches.find(m => /event_applications id=ea1 contact_email/.test(m))
  assert.ok(hit, '불일치가 감지되어야 한다')
  assert.ok(!hit.includes('leaked@evil.example'))
  assert.ok(!hit.includes('a@x.kr'))
  await client.execute("update event_applications set contact_email = 'a@x.kr' where id = 'ea1'")
})

// ---------------------------------------------------------------- 부정 대조 (Step 8)

test('부정 대조 A: 매퍼가 컬럼 하나를 빠뜨리면(system_settings_history) 커버리지 게이트가 loadStage4를 막는다', async () => {
  const good = payload()
  const bad = toSystemSettingsHistoryRow({ ...PG_SYSTEM_SETTINGS_HISTORY, id: 'ssh-broken' })
  delete bad.change_reason // 매퍼 키 하나를 지운 사본 — 운영 매퍼 정의는 건드리지 않는다

  await assert.rejects(
    () =>
      loadStage4({
        client,
        ...good,
        systemSettingsHistory: [good.systemSettingsHistory[0], bad],
      }),
    /system_settings_history: 매핑이 빠뜨린 컬럼 change_reason/
  )
  // 커버리지 검사가 배치보다 먼저 돌기 때문에 두 번째(고장난) 행뿐 아니라
  // 첫 번째(정상) 행도 이번 호출에서는 들어가지 않았어야 한다.
  const r = await client.execute(
    "select count(*) c from system_settings_history where id = 'ssh-broken'"
  )
  assert.equal(r.rows[0].c, 0)
})

test('부정 대조 B: --apply인데 --expect가 표 하나(artists)만 덮으면 거부된다(dry-run은 허용)', () => {
  const [firstTable] = LOAD_ORDER[0]
  const applyResult = evaluateExpectGate({
    expect: { [firstTable]: 13 },
    apply: true,
    parsedCounts: { ...ALL_18_COUNTS, [firstTable]: 13 },
  })
  assert.equal(applyResult.status, 'incomplete_expect')

  const dryRunResult = evaluateExpectGate({
    expect: { [firstTable]: 13 },
    apply: false,
    parsedCounts: { ...ALL_18_COUNTS, [firstTable]: 13 },
  })
  assert.equal(dryRunResult.status, 'matched')
})

test('부정 대조 C: toBool/toBoolDefault는 모르는 토큰에서 던진다(stage4Mapping이 재사용하는 함수)', () => {
  assert.throws(
    () => toBoardMeetingAttendeeRow({ ...PG_BOARD_MEETING_ATTENDEE, attended: 'maybe' }),
    /boolean으로 해석할 수 없다/
  )
  assert.throws(
    () => toUserSessionRow({ ...PG_USER_SESSION, is_active: 'YES' }),
    /boolean으로 해석할 수 없다/
  )
})
