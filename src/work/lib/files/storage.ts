import { copy, del, list, put } from '@vercel/blob'
import { getPrivateObject, headPrivateObject } from '@/lib/storage/blob'
import { isSafeBoardWorkPath, rangeHeaderValue } from '@/lib/storage/boardWork'
import { StorageUnavailableError } from './storage-errors'

/**
 * 업무툴 파일 저장소(비공개 Vercel Blob) 접근 — 서버 전용. 원본 kosmart-work `lib/files/storage.ts`(Supabase Storage
 * `work-files` 버킷 + 서명 URL)를 다시 썼다(설계 §7). **권한을 판단하지 않는다** — 호출 전에 첨부 읽기 권한을 끝낸
 * 행의 경로만 넘긴다. 대신 모든 함수가 첫 줄에서 `isSafeBoardWorkPath`로 경로 모양을 다시 본다: 같은 저장소에
 * DB 백업(`backups/`)·메일 첨부(`mailbox/`)가 있어서, 경로가 새면 그대로 조합원 명부가 나간다.
 *
 * 원본과 다른 점:
 * - 서명 URL·302가 없다. 라우트가 요청마다 권한을 다시 판정하고 `readObject`로 스트리밍한다(Range 전달).
 * - 이동(move)이 없다. 처음부터 최종 키에 올리고 승격은 DB 행만 바꾼다.
 * - 토큰: `BOARD_WORK_BLOB_READ_WRITE_TOKEN`이 **정의돼 있으면(빈 값 포함) 그것만** 쓴다. 정의돼 있지 않으면
 *   `PRIVATE_BLOB_READ_WRITE_TOKEN`. E2E는 이 변수를 늘 정의해(시험 저장소 토큰 또는 빈 값) 운영 비공개 저장소로
 *   떨어지지 않게 한다(playwright.config.ts). 빈 값이면 저장소를 부르지 않고 `StorageUnconfiguredError`를 던진다.
 */

/** 저장소 토큰이 설정되지 않았다 — 라우트는 503으로 알린다(권한 판정은 이미 통과한 뒤다) */
export class StorageUnconfiguredError extends Error {
  constructor() {
    super('파일 저장소가 설정되지 않았습니다. 관리자에게 알려 주세요.')
    this.name = 'StorageUnconfiguredError'
  }
}

/** 안전하지 않은 경로 — 저장소를 부르지 않는다 */
export class UnsafeStoragePathError extends Error {
  constructor() {
    super('안전하지 않은 저장소 경로입니다.')
    this.name = 'UnsafeStoragePathError'
  }
}

/** 저장소가 요청 범위를 줄 수 없다(416) */
export class RangeNotSatisfiableError extends Error {
  constructor() {
    super('요청한 범위를 줄 수 없습니다.')
    this.name = 'RangeNotSatisfiableError'
  }
}

/** 업무툴 저장소 토큰. 없으면 null(호출자가 StorageUnconfiguredError로 바꾼다) */
export function boardWorkBlobToken(): string | null {
  const override = process.env.BOARD_WORK_BLOB_READ_WRITE_TOKEN
  if (override !== undefined) return override.trim() || null
  return process.env.PRIVATE_BLOB_READ_WRITE_TOKEN?.trim() || null
}

/** 업무툴 저장소가 설정돼 있는가(업로드 준비 단계에서 미리 거절할 때) */
export function hasBoardWorkStore(): boolean {
  return boardWorkBlobToken() !== null
}

function token(): string {
  const t = boardWorkBlobToken()
  if (!t) throw new StorageUnconfiguredError()
  return t
}

function guard(path: string): void {
  if (!isSafeBoardWorkPath(path)) throw new UnsafeStoragePathError()
}

/** 키로 쓰면 안 되는 경로(원본 isUnsafeStoragePath 자리) — 이제 허용 모양만 통과시킨다 */
export function isUnsafeStoragePath(path: string): boolean {
  return !isSafeBoardWorkPath(path)
}

function isRangeError(e: unknown): boolean {
  return e instanceof Error && /\b416\b/.test(e.message)
}

export type StoredObject = {
  stream: ReadableStream
  contentType: string
  etag: string
  /** 저장소가 부분 응답을 줬다면 그 `content-range`(206 판정용) */
  contentRange: string | null
  contentLength: string | null
}

/**
 * 객체 스트림. 없으면 null. `range`는 호출자가 검증한 단일 범위(`parseByteRange`)다.
 * 416은 RangeNotSatisfiableError, 그 밖의 저장소 오류는 StorageUnavailableError로 던진다.
 */
export async function readObject(
  path: string,
  opts: { range?: { start: number; end: number } } = {}
): Promise<StoredObject | null> {
  guard(path)
  const t = token()
  let result: Awaited<ReturnType<typeof getPrivateObject>>
  try {
    result = await getPrivateObject(path, undefined, {
      token: t,
      ...(opts.range ? { range: rangeHeaderValue(opts.range) } : {}),
    })
  } catch (e) {
    if (isRangeError(e)) throw new RangeNotSatisfiableError()
    throw new StorageUnavailableError(e instanceof Error ? e.message : String(e))
  }
  if (!result || !result.stream) return null
  return {
    stream: result.stream,
    contentType: result.contentType,
    etag: result.etag,
    contentRange: result.contentRange,
    contentLength: result.contentLength,
  }
}

/**
 * 객체 메타(실제 크기). **명시적으로 없을 때만** null — 그 밖의 오류(5xx·네트워크·시간 초과)는
 * StorageUnavailableError 로 던진다(없음으로 오해해 완료된 업로드를 지우지 않게).
 */
export async function statObject(
  path: string
): Promise<{ size: number; contentType: string | null } | null> {
  guard(path)
  const t = token()
  try {
    return await headPrivateObject(path, { token: t })
  } catch (e) {
    throw new StorageUnavailableError(e instanceof Error ? e.message : String(e))
  }
}

/** 객체 전체를 메모리로(썸네일·문서 변환용 — 호출자가 크기 상한을 먼저 본다). 없으면 던진다 */
export async function downloadObject(path: string): Promise<Buffer> {
  const obj = await readObject(path)
  if (!obj) throw new Error('파일 읽기 실패: 객체가 없습니다')
  return Buffer.from(await new Response(obj.stream).arrayBuffer())
}

/** 서버가 만드는 객체(썸네일·렌더 캐시). 같은 키는 덮어쓴다(렌더 캐시 재생성) */
export async function uploadBuffer(path: string, body: Buffer, contentType: string): Promise<void> {
  guard(path)
  await put(path, body, {
    access: 'private',
    contentType,
    token: token(),
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

/** 없는 객체는 무시한다(`del()`은 멱등). 안전하지 않은 경로가 하나라도 있으면 아무것도 지우지 않는다 */
export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  for (const p of paths) guard(p)
  await del(paths, { token: token() })
}

/**
 * 같은 저장소 안 복사(되돌리기·사본으로 새 문서 — 원본 Storage copy). 두 경로 모두 업무툴 경로여야 한다.
 * 대상 키는 서버가 새 업로드 id 로 만든다(덮어쓰지 않는다). 저장소 오류는 StorageUnavailableError.
 */
export async function copyObject(from: string, to: string): Promise<void> {
  guard(from)
  guard(to)
  const t = token()
  try {
    await copy(from, to, {
      access: 'private',
      token: t,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
  } catch (e) {
    throw new StorageUnavailableError(e instanceof Error ? e.message : String(e))
  }
}

/** 목록 접두로 허용하는 것 — 업무툴 파일·미리보기 캐시 폴더뿐(다른 비공개 객체 `backups/`·`mailbox/`를 훑지 않는다) */
export const LISTABLE_PREFIXES = ['board-work/files/', 'board-work/renders/'] as const

export type ListedWorkObject = { pathname: string; uploadedAt: Date }

/**
 * 업무툴 객체 한 페이지(정리 크론 전용). 접두는 `LISTABLE_PREFIXES`로 시작해야 한다. 돌려주는 키 중
 * `isSafeBoardWorkPath`를 지나지 못하는 것은 **목록에서 빼고** `skipped`로 센다 — 호출부가 지울 수 없는 키를 받지 않게.
 * 저장소 오류는 StorageUnavailableError.
 */
export async function listObjectsPage(
  prefix: string,
  cursor?: string,
  limit = 1000
): Promise<{
  objects: ListedWorkObject[]
  skipped: number
  cursor: string | null
  hasMore: boolean
}> {
  if (!LISTABLE_PREFIXES.some(p => prefix.startsWith(p)) || prefix.includes('..')) {
    throw new UnsafeStoragePathError()
  }
  const t = token()
  let res: Awaited<ReturnType<typeof list>>
  try {
    res = await list({ prefix, cursor, limit: Math.min(Math.max(limit, 1), 1000), token: t })
  } catch (e) {
    throw new StorageUnavailableError(e instanceof Error ? e.message : String(e))
  }
  const objects: ListedWorkObject[] = []
  let skipped = 0
  for (const b of res.blobs) {
    if (isSafeBoardWorkPath(b.pathname)) {
      objects.push({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })
    } else skipped++
  }
  return { objects, skipped, cursor: res.cursor ?? null, hasMore: Boolean(res.hasMore) }
}
