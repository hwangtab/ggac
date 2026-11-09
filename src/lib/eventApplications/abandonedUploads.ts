/**
 * 제출되지 않은 **행사 신청 사진** 정리(2026-11-09).
 *
 * 왜: 신청 폼은 작성 중 미리보기를 위해 사진을 공개 저장소에 임시로 올리고, 접수할 때
 * 서버가 비공개 저장소로 옮긴다(`src/lib/eventApplications/photo.ts`). 그런데 폼을 채우다
 * 닫은 사람의 사진은 아무 신청도 가리키지 않은 채 **공개 저장소에 남는다.** 그 파일은
 * 아무도 보지 않지만 계속 공개로 존재하고, 시간이 지나면 아무도 그게 무엇인지 모른다.
 *
 * 그래서 하루 한 번(업로드 정리 크론) 이 스윕이 `attachments/event-applications/` 아래에서
 * **어떤 신청도 가리키지 않고 48시간이 지난** 객체를 지운다.
 *
 * 안전장치(다른 정리 작업들과 같은 이유):
 *  - 48시간 안 된 것은 건드리지 않는다 — 지금 폼을 채우고 있는 사람의 사진일 수 있다.
 *  - 접두 밖 경로는 목록에 있어도 거부한다 — 같은 공개 저장소에 게시글 첨부·아티스트 사진이 있다.
 *  - 미참조가 한 번에 너무 많으면(차단기) **하나도 지우지 않고 멈춘다** — 저장소와 DB가 다른
 *    환경(예: 로컬 DB + 운영 저장소 토큰)일 때 운영 사진을 통째로 지우는 사고를 막는다.
 *  - 한 번에 지우는 수에 상한을 둔다(크론 시간 제한). 남은 것은 다음 실행이 이어서 한다.
 *
 * 판정은 순수 함수로 두고 저장소·DB는 주입받는다 — 네트워크 없이 단위 테스트한다.
 */
import { listEventPhotoPublicUrls } from '@/db/queries/misc'
import { publicEventPhotoPath } from './photo'
import { deleteObject, listObjects } from '@/lib/storage/blob'
import { createLogger } from '@/utils/logger'

const log = createLogger('lib/eventApplications/abandonedUploads')

/** 신청 폼이 사진을 올리는 공개 접두 — 업로드 라우트와 같아야 한다(`attachments/…` 포함) */
export const ABANDONED_PHOTO_PREFIX = 'attachments/event-applications/'
/** 이보다 오래된 것만 본다(폼 작성 중인 업로드를 지우지 않게) */
export const ABANDONED_MIN_AGE_MS = 48 * 3600 * 1000
/** 한 번에 지우는 최대 수 */
export const ABANDONED_MAX_REMOVALS = 200
/** 목록 상한 */
export const ABANDONED_LIST_LIMIT = 1000
/** 차단기: 미참조가 이만큼 이상이면서 훑은 것의 절반을 넘으면 지우지 않고 멈춘다 */
export const ABANDONED_BREAKER_MIN = 50

export type AbandonedPhotoObject = { pathname: string; uploadedAt: Date }

export type AbandonedPhotoSweepDeps = {
  list: () => Promise<AbandonedPhotoObject[]>
  /** 이 경로들을 가리키는 신청이 있는가 — 있으면 지우지 않는다 */
  findReferenced: (paths: string[]) => Promise<ReadonlySet<string>>
  remove: (paths: string[]) => Promise<void>
  now: () => Date
}

export class AbandonedPhotoSweepAbortedError extends Error {
  readonly orphans: number
  readonly scanned: number
  constructor(orphans: number, scanned: number) {
    super(
      `미참조 신청 사진이 너무 많아 멈췄다(${orphans}/${scanned}) — DB와 저장소가 같은 환경인지 확인할 것`
    )
    this.name = 'AbandonedPhotoSweepAbortedError'
    this.orphans = orphans
    this.scanned = scanned
  }
}

/** 접두 안의 경로만, 그리고 규약(상위 참조 없음)을 지키는 것만 대상으로 삼는다. */
export function isSweepableEventPhotoPath(pathname: string): boolean {
  if (typeof pathname !== 'string' || !pathname) return false
  if (!pathname.startsWith(ABANDONED_PHOTO_PREFIX)) return false
  if (pathname.includes('..')) return false
  return true
}

/**
 * 스윕 한 번. 지운 수·훑은 수를 돌려준다.
 * 미참조가 차단기를 넘으면 `AbandonedPhotoSweepAbortedError`를 던지고 **아무것도 지우지 않는다.**
 */
export async function sweepAbandonedEventPhotos(
  deps: AbandonedPhotoSweepDeps
): Promise<{ scanned: number; removed: number; capped: boolean }> {
  const now = deps.now().getTime()
  const cutoff = now - ABANDONED_MIN_AGE_MS

  const objects = await deps.list()
  const old = objects
    .filter(o => isSweepableEventPhotoPath(o.pathname))
    .filter(o => Number.isFinite(o.uploadedAt.getTime()) && o.uploadedAt.getTime() < cutoff)
    .map(o => o.pathname)

  if (old.length === 0) return { scanned: objects.length, removed: 0, capped: false }

  const referenced = await deps.findReferenced(old)
  const orphans = old.filter(pathname => !referenced.has(pathname))

  if (orphans.length >= ABANDONED_BREAKER_MIN && orphans.length * 2 > old.length) {
    throw new AbandonedPhotoSweepAbortedError(orphans.length, old.length)
  }

  const toRemove = orphans.slice(0, ABANDONED_MAX_REMOVALS)
  if (toRemove.length > 0) await deps.remove(toRemove)

  return {
    scanned: objects.length,
    removed: toRemove.length,
    capped: orphans.length > toRemove.length,
  }
}

/** 실제 저장소·DB로 도는 기본 구현. 라우트는 이걸 그대로 부른다. */
export function defaultAbandonedPhotoSweepDeps(): AbandonedPhotoSweepDeps {
  return {
    list: () => listObjects('public', ABANDONED_PHOTO_PREFIX, ABANDONED_LIST_LIMIT),
    findReferenced: async paths => {
      const urls = await listEventPhotoPublicUrls()
      const known = new Set(
        urls
          .map(url => publicEventPhotoPath(url))
          .filter((pathname): pathname is string => pathname !== null)
      )
      return new Set(paths.filter(p => known.has(p)))
    },
    remove: async paths => {
      for (const pathname of paths) {
        await deleteObject('public', pathname)
      }
    },
    now: () => new Date(),
  }
}

/** 라우트용 얇은 껍데기 — 실패해도 크론 전체를 죽이지 않는다(로그만). */
export async function runAbandonedEventPhotoSweep(): Promise<{
  scanned: number
  removed: number
  capped: boolean
  failed: boolean
}> {
  try {
    const result = await sweepAbandonedEventPhotos(defaultAbandonedPhotoSweepDeps())
    if (result.removed > 0) log.info('제출되지 않은 신청 사진을 지웠다', result)
    return { ...result, failed: false }
  } catch (error) {
    log.error('제출되지 않은 신청 사진 정리 실패', error)
    return { scanned: 0, removed: 0, capped: false, failed: true }
  }
}
