/**
 * 단계 4: 콘텐츠·신원 외 나머지 전부의 매퍼.
 *
 * 이관 대상 18표(운영 실측 2026-08-25):
 *   artists 13 · board_meetings 12 · board_agendas 55 · board_minutes 11 ·
 *   board_documents 14 · board_meeting_attendees 16 ·
 *   board_meeting_date_options 0 · board_meeting_date_votes 0 ·
 *   system_settings 19 · system_settings_history 4 · default_settings 16 ·
 *   user_settings 0 · user_activities 11083 · user_sessions 5937 ·
 *   daily_activity_stats 865 · link_previews 20 · event_applications 15 ·
 *   member_bulk_operations 0
 *
 * contentMapping.mjs·identityMapping.mjs와 같은 규칙을 따른다: 각 함수는
 * Drizzle 스키마의 컬럼과 정확히 같은 키 집합을 스프레드 없이 명시해
 * 돌려준다. 변환 원시 함수(toBool/toInt/toTs/toJsonText)는 새로 만들지
 * 않고 contentMapping.mjs 것을 그대로 재사용한다 — 특히 toBool은 모르는
 * 토큰에서 반드시 던져야 한다(is_active 같은 컬럼이 조용히 전멸하는 사고를
 * 막는다).
 */
import { toBool, toBoolDefault, toInt, toTs, toJsonText } from './contentMapping.mjs'
import { toArtistRow } from './identityMapping.mjs'
import { pgArrayToJsonText } from './pgDumpParser.mjs'

/**
 * nullable jsonb 컬럼용. toJsonText와 달리 NULL을 '{}' 등으로 정규화하지
 * 않고 그대로 null로 둔다 — system_settings_history.old_value/new_value처럼
 * Postgres가 NOT NULL을 선언하지 않은 컬럼에 쓴다. 값이 있으면 toJsonText와
 * 동일하게 직렬화한다.
 */
export const toJsonTextOrNull = v => (v === null || v === undefined ? null : toJsonText(v))

// event_applications.contact_email 등 개인정보 컬럼은 여기서 값을 찍지
// 않는다 — 이 파일은 순수 변환 함수만 담고, 로그를 남기는 쪽(stage4.mjs)이
// PII 무출력 원칙을 지킨다.

// ---------------------------------------------------------------- artists
// 단계 2b에서 이미 Turso에 적재된 13행과 같은 소스(운영 Postgres)를 다시
// 옮긴다. 컬럼·변환 규칙이 identityMapping.mjs와 완전히 같으므로 새로
// 만들지 않고 재수출한다 — stage4.mjs가 이 이름으로 import한다.
export { toArtistRow }

// ---------------------------------------------------------------- board_*

/** board_meetings 9행. created_by는 nullable(실측 12행 중 10행이 NULL). */
export function toBoardMeetingRow(r) {
  return {
    id: r.id,
    title: r.title,
    // date 전용 컬럼 — 'YYYY-MM-DD' 문자열 그대로 옮긴다.
    meeting_date: r.meeting_date,
    location: r.location,
    status: r.status,
    vote_deadline: toTs(r.vote_deadline),
    created_by: r.created_by,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
  }
}

/** board_agendas 9컬럼. sort_order는 NOT NULL default 0. */
export function toBoardAgendaRow(r) {
  return {
    id: r.id,
    meeting_id: r.meeting_id,
    title: r.title,
    content: r.content,
    sort_order: toInt(r.sort_order) ?? 0,
    status: r.status,
    proposed_by: r.proposed_by,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
  }
}

/** board_minutes 7컬럼. */
export function toBoardMinuteRow(r) {
  return {
    id: r.id,
    meeting_id: r.meeting_id,
    content: r.content,
    content_format: r.content_format,
    author_id: r.author_id,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
  }
}

/** board_documents 9컬럼. file_size는 nullable integer. */
export function toBoardDocumentRow(r) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    file_path: r.file_path,
    file_name: r.file_name,
    file_size: toInt(r.file_size),
    mime_type: r.mime_type,
    uploaded_by: r.uploaded_by,
    created_at: toTs(r.created_at),
  }
}

/** board_meeting_attendees 6컬럼. attended는 NOT NULL default false. */
export function toBoardMeetingAttendeeRow(r) {
  return {
    id: r.id,
    meeting_id: r.meeting_id,
    member_id: r.member_id,
    attended: toBoolDefault(r.attended, false),
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
  }
}

/** board_meeting_date_options 3컬럼. 운영 실측 0행 — 정의만 해둔다. */
export function toBoardMeetingDateOptionRow(r) {
  return {
    id: r.id,
    meeting_id: r.meeting_id,
    candidate_date: r.candidate_date,
  }
}

/** board_meeting_date_votes 6컬럼. is_available은 NOT NULL(기본값 없음). 운영 실측 0행. */
export function toBoardMeetingDateVoteRow(r) {
  return {
    id: r.id,
    option_id: r.option_id,
    voter_id: r.voter_id,
    is_available: toBool(r.is_available),
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
  }
}

// ---------------------------------------------------------------- settings

/** system_settings 9컬럼. setting_value는 NOT NULL default {}. */
export function toSystemSettingRow(r) {
  return {
    id: r.id,
    category: r.category,
    setting_key: r.setting_key,
    setting_value: toJsonText(r.setting_value, '{}'),
    description: r.description,
    is_sensitive: toBoolDefault(r.is_sensitive, false),
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
    updated_by: r.updated_by,
  }
}

/**
 * system_settings_history 9컬럼. old_value/new_value는 Postgres가 NOT
 * NULL을 선언하지 않은 jsonb라 toJsonTextOrNull로 null을 보존한다(운영
 * 실측 4행은 전부 값이 있었지만, 스키마 제약을 관측값으로 대체하지 않는다).
 */
export function toSystemSettingsHistoryRow(r) {
  return {
    id: r.id,
    setting_id: r.setting_id,
    category: r.category,
    setting_key: r.setting_key,
    old_value: toJsonTextOrNull(r.old_value),
    new_value: toJsonTextOrNull(r.new_value),
    changed_by: r.changed_by,
    changed_at: toTs(r.changed_at),
    change_reason: r.change_reason,
  }
}

/** default_settings 7컬럼. default_value는 NOT NULL default {}. */
export function toDefaultSettingRow(r) {
  return {
    id: r.id,
    category: r.category,
    setting_key: r.setting_key,
    default_value: toJsonText(r.default_value, '{}'),
    description: r.description,
    is_required: toBoolDefault(r.is_required, false),
    created_at: toTs(r.created_at),
  }
}

/** user_settings 7컬럼. setting_value는 NOT NULL default {}. 운영 실측 0행. */
export function toUserSettingRow(r) {
  return {
    id: r.id,
    user_id: r.user_id,
    category: r.category,
    setting_key: r.setting_key,
    setting_value: toJsonText(r.setting_value, '{}'),
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
  }
}

// ---------------------------------------------------------------- activity

/** user_activities 10컬럼. metadata는 NOT NULL default {}. */
export function toUserActivityRow(r) {
  return {
    id: r.id,
    user_id: r.user_id,
    action_type: r.action_type,
    target_type: r.target_type,
    target_id: r.target_id,
    metadata: toJsonText(r.metadata, '{}'),
    ip_address: r.ip_address,
    user_agent: r.user_agent,
    session_id: r.session_id,
    created_at: toTs(r.created_at),
  }
}

/**
 * user_sessions 10컬럼. is_active는 NOT NULL default true, metadata는
 * NOT NULL default {}. logout_at만 nullable(운영 실측: 5937행 중 22행 NULL
 * — 아직 로그아웃하지 않은 활성 세션).
 */
export function toUserSessionRow(r) {
  return {
    id: r.id,
    user_id: r.user_id,
    session_token: r.session_token,
    last_activity: toTs(r.last_activity),
    is_active: toBoolDefault(r.is_active, true),
    ip_address: r.ip_address,
    user_agent: r.user_agent,
    login_at: toTs(r.login_at),
    logout_at: toTs(r.logout_at),
    metadata: toJsonText(r.metadata, '{}'),
  }
}

/** daily_activity_stats 6컬럼. count는 NOT NULL default 0. */
export function toDailyActivityStatRow(r) {
  return {
    id: r.id,
    // date 전용 컬럼 — 'YYYY-MM-DD' 문자열 그대로 옮긴다.
    activity_date: r.activity_date,
    user_id: r.user_id,
    action_type: r.action_type,
    count: toInt(r.count) ?? 0,
    last_updated: toTs(r.last_updated),
  }
}

// ---------------------------------------------------------------- 그 밖

/**
 * link_previews 6컬럼. PK가 `id`가 아니라 `url`이다 — stage4.mjs가
 * `buildUpsert(table, row, pkColumn)`을 이 표만 pkColumn='url'로 호출한다.
 */
export function toLinkPreviewRow(r) {
  return {
    url: r.url,
    data: toJsonText(r.data, '{}'),
    last_fetched: toTs(r.last_fetched),
    ttl_seconds: toInt(r.ttl_seconds) ?? 21600,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
  }
}

/**
 * event_applications 16컬럼. applicant_name·contact_email·contact_phone·
 * message에 신청자 개인정보가 들어 있다 — stage4.mjs는 이 표의 값을 절대
 * 화면에 찍지 않는다.
 */
export function toEventApplicationRow(r) {
  return {
    id: r.id,
    event_slug: r.event_slug,
    applicant_name: r.applicant_name,
    contact_email: r.contact_email,
    contact_phone: r.contact_phone,
    performance_info: r.performance_info,
    items_to_sell: r.items_to_sell,
    links: r.links,
    message: r.message,
    status: r.status,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
    privacy_consent: toBoolDefault(r.privacy_consent, false),
    privacy_consent_at: toTs(r.privacy_consent_at),
    participation_type: r.participation_type,
    photo_url: r.photo_url,
  }
}

/**
 * member_bulk_operations 11컬럼. member_ids는 Postgres uuid[]라
 * `pgArrayToJsonText`로 배열 리터럴을 판다(toJsonText를 썼다면 fallback
 * 기본값 '{}'가 걸려 배열 컬럼에 객체 리터럴 문자열이 들어가는 오류가
 * 있었다). fallback을 안 줬으므로 NOT NULL(Postgres도 기본값 없는 uuid[]
 * NOT NULL)이라 비어 있으면 원본 데이터 문제로 그대로 null이 들어가
 * DB의 NOT NULL 제약이 잡는다. parameters/results는 NOT NULL default {}.
 * 운영 실측 0행.
 */
export function toMemberBulkOperationRow(r) {
  return {
    id: r.id,
    operation_type: r.operation_type,
    performed_by: r.performed_by,
    member_ids: pgArrayToJsonText(r.member_ids),
    parameters: toJsonText(r.parameters, '{}'),
    results: toJsonText(r.results, '{}'),
    status: r.status,
    created_at: toTs(r.created_at),
    started_at: toTs(r.started_at),
    completed_at: toTs(r.completed_at),
    error_message: r.error_message,
  }
}
