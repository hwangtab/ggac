import { copy, del, put } from '@vercel/blob'
import { getPrivateObject, headPrivateObject } from '@/lib/storage/blob'
import { rangeHeaderValue } from '@/lib/storage/boardWork'
import { StorageUnavailableError } from './storage-errors'

/**
 * 경로 판정이 붙은 비공개 Blob 저장소 계층(서버 전용) — 업무툴 첨부(`storage.ts`, `board-work/…`)와 조합원 내 문서함
 * (`src/lib/memberDocuments/storage.ts`, `member-documents/…`)이 한 벌씩 만들어 쓴다(docs/board-work/04-조합원-문서함.md §3-3).
 *
 * **권한을 판단하지 않는다** — 호출 전에 대상 행의 권한을 끝낸 경로만 넘긴다. 대신 모든 함수가 첫 줄에서 만들 때 받은
 * `guard`로 경로 모양을 다시 본다: 같은 저장소에 DB 백업(`backups/`)·메일 첨부(`mailbox/`)·이사회 서류가 있어서, 경로가
 * 새면 그대로 조합원 명부가 나간다. 경로 하나라도 판정을 지나지 못하면 저장소를 부르지 않는다.
 *
 * 토큰은 `boardWorkBlobToken()`(storage.ts)이 정한다: `BOARD_WORK_BLOB_READ_WRITE_TOKEN`이 정의돼 있으면(빈 값 포함)
 * 그것만, 아니면 `PRIVATE_BLOB_READ_WRITE_TOKEN`. E2E는 앞의 변수를 늘 정의해 운영 저장소에 닿지 않는다.
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

/** 업무툴·문서함 저장소 토큰. 없으면 null(호출자가 StorageUnconfiguredError로 바꾼다) */
export function privateStoreToken(): string | null {
  const override = process.env.BOARD_WORK_BLOB_READ_WRITE_TOKEN
  if (override !== undefined) return override.trim() || null
  return process.env.PRIVATE_BLOB_READ_WRITE_TOKEN?.trim() || null
}

export type StoredObject = {
  stream: ReadableStream
  contentType: string
  etag: string
  /** 저장소가 부분 응답을 줬다면 그 `content-range`(206 판정용) */
  contentRange: string | null
  contentLength: string | null
}

export type GuardedPrivateStore = {
  /** 객체 스트림. 없으면 null. 416은 RangeNotSatisfiableError, 그 밖의 저장소 오류는 StorageUnavailableError */
  readObject: (
    path: string,
    opts?: { range?: { start: number; end: number } }
  ) => Promise<StoredObject | null>
  /** 객체 메타(실제 크기). **명시적으로 없을 때만** null — 그 밖의 오류는 StorageUnavailableError */
  statObject: (path: string) => Promise<{ size: number; contentType: string | null } | null>
  /** 객체 전체를 메모리로(호출자가 크기 상한을 먼저 본다). 없으면 던진다 */
  downloadObject: (path: string) => Promise<Buffer>
  /** 서버가 만드는 객체. 같은 키는 덮어쓴다 */
  uploadBuffer: (path: string, body: Buffer, contentType: string) => Promise<void>
  /** 없는 객체는 무시한다(`del()`은 멱등). 안전하지 않은 경로가 하나라도 있으면 아무것도 지우지 않는다 */
  removeObjects: (paths: string[]) => Promise<void>
  /** 같은 저장소 안 복사. 두 경로 모두 판정을 지나야 한다. 덮어쓰지 않는다 */
  copyObject: (from: string, to: string) => Promise<void>
}

function isRangeError(e: unknown): boolean {
  return e instanceof Error && /\b416\b/.test(e.message)
}

/** `guard`(경로 판정)를 붙인 저장소 계층 한 벌 */
export function createGuardedPrivateStore(guard: (path: unknown) => boolean): GuardedPrivateStore {
  const check = (path: string) => {
    if (!guard(path)) throw new UnsafeStoragePathError()
  }
  const token = (): string => {
    const t = privateStoreToken()
    if (!t) throw new StorageUnconfiguredError()
    return t
  }

  async function readObject(
    path: string,
    opts: { range?: { start: number; end: number } } = {}
  ): Promise<StoredObject | null> {
    check(path)
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

  async function statObject(
    path: string
  ): Promise<{ size: number; contentType: string | null } | null> {
    check(path)
    const t = token()
    try {
      return await headPrivateObject(path, { token: t })
    } catch (e) {
      throw new StorageUnavailableError(e instanceof Error ? e.message : String(e))
    }
  }

  async function downloadObject(path: string): Promise<Buffer> {
    const obj = await readObject(path)
    if (!obj) throw new Error('파일 읽기 실패: 객체가 없습니다')
    return Buffer.from(await new Response(obj.stream).arrayBuffer())
  }

  async function uploadBuffer(path: string, body: Buffer, contentType: string): Promise<void> {
    check(path)
    await put(path, body, {
      access: 'private',
      contentType,
      token: token(),
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  }

  async function removeObjects(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    for (const p of paths) check(p)
    await del(paths, { token: token() })
  }

  async function copyObject(from: string, to: string): Promise<void> {
    check(from)
    check(to)
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

  return { readObject, statObject, downloadObject, uploadBuffer, removeObjects, copyObject }
}
