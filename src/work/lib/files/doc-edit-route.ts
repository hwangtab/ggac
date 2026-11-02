import { NextResponse } from 'next/server'
import { z } from 'zod'
import { consumeWorkDocEdit } from '@/lib/server/boardWorkRateLimit'
import { loadChannelAccess, viewerOf, type WorkViewer } from '@/lib/server/boardWorkChannelAuth'
import { getAttachmentForEdit } from '@/db/queries/work/versions'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { DocEditError } from './doc-edit'
import { NO_STORE, NOT_FRAMEABLE, workClientFor } from './file-response'
import { getReadableAttachment } from './queries'
import {
  DOC_EDIT_MAX_BYTES,
  RENDER_ERROR_MESSAGE,
  RENDER_ERROR_STATUS,
  RenderError,
  isDocEditFile,
} from './render-types'
import type { Attachment } from './schema'
import { downloadObject } from './storage'
import { editDeniedMessage } from './version-rules'

/**
 * 문서 편집 Route Handler(form · blocks · draft · drafts/…/{verify,render} · new-drafts/…)가 같이 쓰는 도우미 — 서버 전용.
 * 원본 kosmart-work `lib/files/doc-edit-route.ts`를 옮겼다. 바뀐 점:
 * - 게이트: 라우트가 첫 줄에서 `requireBoardMember()`를 부르고(정적 가드가 요구한다) 그 사용자 id 를 여기 넘긴다.
 *   원본 requireStaffRoute(로그인·staff·이메일 코드) 자리다. 그 뒤 업무툴 역할(`workClientFor`) → 읽기 → 편집 권한.
 * - API 경로는 전역 보안 헤더 대상이 아니라 응답마다 파일 라우트와 같은 헤더(no-store·nosniff·프레임 금지)를 붙인다.
 * - 사용량 제한은 원본의 프로세스 메모리 리미터 대신 분산 리미터(WORK_DOC_EDIT_READ·WORK_DOC_EDIT_DRAFT).
 * 문서 내용·입력 값은 로그에 남기지 않는다(오류는 코드만).
 */

export const DOC_EDIT_PRIVATE_HEADERS = {
  ...NO_STORE,
  ...NOT_FRAMEABLE,
} as const

/**
 * 초안 쪽 SVG — `<img>`로만 쓰인다. 스크립트·외부 요청이 돌지 못하게 문서 단위로 막는다(문서 뷰어 render 라우트와 같은 CSP).
 * 초안은 다시 만들면 새 uploadId 라 키가 곧 버전이다. 권한은 매 요청 확인하고 공유 캐시는 금지(원본과 같은 private 10분).
 */
export const DRAFT_SVG_HEADERS = {
  'Cache-Control': 'private, max-age=600',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'none'",
  'Content-Type': 'image/svg+xml',
} as const

export type DocEditFailCode =
  | 'not_found'
  | 'forbidden'
  | 'unsupported'
  | 'too_large'
  | 'bad_request'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'server'

const FAIL_STATUS: Record<DocEditFailCode, number> = {
  not_found: 404,
  forbidden: 403,
  unsupported: 415,
  too_large: 413,
  bad_request: 400,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  server: 500,
}

const FAIL_MESSAGE: Record<DocEditFailCode, string> = {
  not_found: '파일을 찾을 수 없거나 권한이 없습니다.',
  forbidden: '이 파일을 고칠 권한이 없습니다.',
  unsupported: 'HWP·HWPX 문서만 앱에서 고칠 수 있습니다.',
  too_large: `파일이 커서 앱에서 고칠 수 없습니다(${DOC_EDIT_MAX_BYTES / 1024 / 1024}MB 이하). 내 PC에서 수정을 써 주세요.`,
  bad_request: '요청 내용을 확인해 주세요.',
  conflict: '문서 내용이 달라졌습니다. 새로 고친 뒤 다시 시도해 주세요.',
  rate_limited: '너무 자주 요청했습니다. 잠시 뒤 다시 시도해 주세요.',
  unavailable: '원본 파일을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  server: '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
}

export function docEditFail(code: DocEditFailCode, message?: string): NextResponse {
  return NextResponse.json(
    { error: code, message: message ?? FAIL_MESSAGE[code] },
    { status: FAIL_STATUS[code], headers: DOC_EDIT_PRIVATE_HEADERS }
  )
}

/** 변환·편집 오류 → 응답. 알 수 없는 예외는 내용 없이 'server' */
export function docEditErrorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof RenderError) {
    return NextResponse.json(
      { error: e.code, message: RENDER_ERROR_MESSAGE[e.code] },
      { status: RENDER_ERROR_STATUS[e.code], headers: DOC_EDIT_PRIVATE_HEADERS }
    )
  }
  if (e instanceof DocEditError) {
    return docEditFail(e.code === 'conflict' ? 'conflict' : 'bad_request', e.message)
  }
  // 문서 글자가 섞일 수 있어 메시지는 남기지 않는다
  console.error(`[${where}] 예외(내용 생략):`, e instanceof Error ? e.name : typeof e)
  return docEditFail('server')
}

/** 사용자 단위 분산 제한(원본 hitDocEditLimit 자리). 넘으면 429 응답 */
export async function hitDocEditLimit(
  userId: string,
  kind: 'read' | 'draft'
): Promise<NextResponse | null> {
  const r = await consumeWorkDocEdit(userId, kind)
  if (r.ok) return null
  const res = docEditFail('rate_limited')
  res.headers.set('Retry-After', '60')
  return res
}

export type EditChannel = {
  id: string
  kind: 'public' | 'private' | 'dm'
  slug: string | null
  archived_at: string | null
  post_policy: string
}

export type EditableCtx = {
  client: WorkServerClient
  viewer: WorkViewer
  user: WorkServerClient['user']
  staff: WorkServerClient['staff']
  attachment: Attachment
  channel: EditChannel
}

const uuidSchema = z.string().uuid()

/** strict: false 라 판별 유니온이 좁혀지지 않는다 — 한 모양(ok 면 ctx, 아니면 response) */
export type Opened = { ok: boolean; ctx?: EditableCtx; response?: NextResponse }

/**
 * 업무툴 역할(requireBoardMember 다음). 구성원이 아니면 403 응답.
 */
export async function docEditClient(userId: string): Promise<WorkServerClient | NextResponse> {
  const client = await workClientFor(userId)
  return client instanceof NextResponse ? docEditFail('forbidden') : client
}

/**
 * 첨부 id → 편집 컨텍스트(`userId`는 requireBoardMember 를 통과한 사람). 순서: id 형식 → 업무툴 역할 →
 * 읽기 가능(읽기 범위·게시물 미삭제, 아니면 404) → HWP·HWPX·크기 → 편집 권한(멤버·게스트·보관 채널, 아니면 403).
 */
export async function openEditable(
  userId: string,
  id: string,
  opts: { anyFormat?: boolean } = {}
): Promise<Opened> {
  if (!uuidSchema.safeParse(id).success) return { ok: false, response: docEditFail('not_found') }

  const client = await docEditClient(userId)
  if (client instanceof NextResponse) return { ok: false, response: client }

  let attachment: Attachment | null
  try {
    attachment = await getReadableAttachment(client, id)
  } catch (e) {
    return { ok: false, response: docEditErrorResponse(e, 'doc-edit:attachment') }
  }
  if (!attachment) return { ok: false, response: docEditFail('not_found') }
  if (!opts.anyFormat && !isDocEditFile(attachment.name))
    return { ok: false, response: docEditFail('unsupported') }
  if (attachment.size > DOC_EDIT_MAX_BYTES) return { ok: false, response: docEditFail('too_large') }

  const viewer = viewerOf(client)
  let access: Awaited<ReturnType<typeof loadChannelAccess>>
  let edit: Awaited<ReturnType<typeof getAttachmentForEdit>>
  try {
    ;[access, edit] = await Promise.all([
      loadChannelAccess(viewer, attachment.channel_id),
      getAttachmentForEdit(attachment.id),
    ])
  } catch {
    return { ok: false, response: docEditFail('server') }
  }
  if (!access || !access.canRead || !edit) return { ok: false, response: docEditFail('not_found') }

  const denied = editDeniedMessage(
    { isGuest: client.staff.role === 'guest', isMember: access.isMember },
    { channelArchived: access.archived, messageDeleted: false }
  )
  if (denied) return { ok: false, response: docEditFail('forbidden', denied) }

  return {
    ok: true,
    ctx: {
      client,
      viewer,
      user: client.user,
      staff: client.staff,
      attachment,
      channel: edit.channel,
    },
  }
}

/** 원본 바이트를 읽는다(권한은 openEditable 이 끝냈다). 행의 size 는 업로드 기록값이라 실제 길이로 한 번 더 막는다 */
export async function readOriginal(
  ctx: EditableCtx
): Promise<{ ok: boolean; bytes?: Buffer; response?: NextResponse }> {
  let bytes: Buffer
  try {
    bytes = await downloadObject(ctx.attachment.bucket_path)
  } catch {
    // ggac 이식: 원본은 404 로 접었지만, 권한 판정은 이미 끝났다 — 저장소 문제(미설정·일시 오류·객체 없음)를
    // "권한 없음"과 같은 404 로 내면 원인을 가린다. 503 으로 구분한다(문서 내용은 싣지 않는다).
    return { ok: false, response: docEditFail('unavailable') }
  }
  if (bytes.length > DOC_EDIT_MAX_BYTES) return { ok: false, response: docEditFail('too_large') }
  return { ok: true, bytes }
}
