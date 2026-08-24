/**
 * 단계 2c: 콘텐츠 6테이블(posts·comments·post_likes·comment_likes·
 * post_attachments·notifications) + member_profiles 매퍼.
 *
 * identityMapping.mjs와 같은 규칙을 따른다: 각 함수는 Drizzle 스키마의
 * 컬럼과 정확히 같은 키 집합을 스프레드 없이 명시해 돌려준다. 이 파일은
 * pgDumpParser.mjs 하나만 import한다 — 나머지는 순수 변환 함수다.
 */
import { pgTimestampToMs } from './pgDumpParser.mjs'
import { toMemberProfileRow } from './identityMapping.mjs'

/**
 * Postgres 덤프의 boolean.
 * `supabase db dump --data-only`(v2.84.2)는 `true`/`false` 리터럴을 낸다
 * (COPY 형식의 `t`/`f`가 아니다 — 실제 덤프로 확인함). PostgREST 등 다른
 * 경로로 들어올 수 있는 `t`/`f`·`1`도 함께 받아 identityMapping.mjs의
 * bool()과 동일한 관용도를 유지한다.
 */
export const toBool = v => {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v === 'true' || v === 't' || v === '1' || v === 1 ? 1 : 0
}

/** NOT NULL boolean 컬럼용 — null이면 기본값을 쓴다. */
export const toBoolDefault = (v, fallback) => {
  const b = toBool(v)
  return b === null ? (fallback ? 1 : 0) : b
}

export const toInt = v => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`정수가 아니다: ${v}`)
  return n
}

export const toTs = v => (v === null || v === undefined ? null : pgTimestampToMs(v))

/** jsonb 컬럼 → SQLite text. Drizzle의 mode:'json'이 읽을 수 있는 형태. */
export const toJsonText = (v, fallback = '{}') => {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/**
 * posts 13행.
 *
 * like_count는 여기서 원본값을 그대로 옮기지만, content.mjs가 적재 후
 * post_likes에서 COUNT(*)로 재계산해 덮어쓴다(알려진 결함: post_likes에
 * 걸린 트리거 3개 중 2개가 같은 +1 함수를 도는데, 지금 드리프트가 없는
 * 이유는 toggle_post_like RPC가 맨 끝에서 COUNT(*)로 통째로 덮어쓰기
 * 때문이다 — RPC를 거치지 않은 경로가 있었다면 드리프트가 났을 수 있다).
 * 이 자리에서 0으로 두지 않는 이유는, 재계산 단계가 실수로 빠졌을 때
 * 조용히 전부 0이 되는 대신 원본과의 차이가 검증에서 드러나게 하기
 * 위해서다.
 */
export function toPostRow(r) {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category,
    author_id: r.author_id,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
    is_deleted: toBoolDefault(r.is_deleted, false),
    is_pinned: toBoolDefault(r.is_pinned, false),
    pinned_at: toTs(r.pinned_at),
    content_format: r.content_format ?? 'plain',
    like_count: toInt(r.like_count) ?? 0,
    view_count: toInt(r.view_count) ?? 0,
  }
}

/** comments 7행. like_count도 posts와 같은 이유로 재계산 대상이다. */
export function toCommentRow(r) {
  return {
    id: r.id,
    post_id: r.post_id,
    author_id: r.author_id,
    content: r.content,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
    like_count: toInt(r.like_count) ?? 0,
  }
}

export function toPostLikeRow(r) {
  return {
    id: r.id,
    post_id: r.post_id,
    user_id: r.user_id,
    created_at: toTs(r.created_at),
  }
}

export function toCommentLikeRow(r) {
  return {
    id: r.id,
    comment_id: r.comment_id,
    user_id: r.user_id,
    created_at: toTs(r.created_at),
  }
}

/** post_attachments 15행. */
export function toPostAttachmentRow(r) {
  return {
    id: r.id,
    post_id: r.post_id,
    file_name: r.file_name,
    file_url: r.file_url,
    file_type: r.file_type,
    file_size: toInt(r.file_size),
    mime_type: r.mime_type,
    alt_text: r.alt_text,
    is_primary: toBoolDefault(r.is_primary, false),
    sort_order: toInt(r.sort_order) ?? 0,
    created_at: toTs(r.created_at),
    updated_at: toTs(r.updated_at),
    is_temporary: toBoolDefault(r.is_temporary, false),
    temp_session: r.temp_session,
    expires_at: toTs(r.expires_at),
  }
}

/** notifications 11행. data는 NOT NULL — 비어 있으면 '{}'로 채운다. */
export function toNotificationRow(r) {
  return {
    id: r.id,
    user_id: r.user_id,
    type: r.type,
    title: r.title,
    message: r.message,
    data: toJsonText(r.data, '{}'),
    read_at: toTs(r.read_at),
    created_at: toTs(r.created_at),
    expires_at: toTs(r.expires_at),
    related_post_id: r.related_post_id,
    related_user_id: r.related_user_id,
  }
}

// member_profiles는 단계 2b의 identityMapping.mjs에 이미 33개 컬럼을 다루는
// toMemberProfileRow가 있다. 새로 쓰지 않고 재사용한다 — content.mjs가
// 여기서 재수출된 이름을 import한다.
export { toMemberProfileRow }
