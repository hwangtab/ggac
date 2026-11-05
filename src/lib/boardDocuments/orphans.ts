import { findReferencedBoardDocumentPaths } from '@/db/queries/board'
import { OrphanSweepAbortedError } from '@/lib/memberDocuments/retention'
import {
  BOARD_DOCUMENT_PREFIX,
  isSafeBoardDocumentFilePath,
  isSafeBoardDocumentVersionPath,
} from '@/lib/storage/boardDocuments'
import { listBoardDocumentObjectsPage, removeBoardDocumentObjects } from './storage'

/**
 * 이사회 서류 고아 청소 — 행이 하나도 가리키지 않는 `board-documents/` 객체를 지운다(서버 전용).
 *
 * PR #90 부터 서류 파일은 브라우저가 비공개 Blob 에 바로 올리고(`/documents/uploads`) 행은 JSON 등록이 따로 만든다. 올린 뒤
 * 등록하지 않으면(탭을 닫음·회선 끊김) 객체가 영영 남았다. 앱 편집 저장본(`/[id]/edit-uploads` →
 * `board-documents/versions/<서류>/<업로드 id>/<이름>`)도 승격(`/versions`) 전에 끊기면 마찬가지다(서류를 지울 때만
 * 그 서류의 `versions/` 아래를 함께 지운다 — `./cleanup.ts`). 서류 삭제 뒤 객체 삭제가 실패한 흔적도 여기서 줍는다.
 *
 * 경로 대응(틀리면 산 이사회 기록을 지운다):
 *  - 객체 키 = `board-documents/` + `file_path`(`blobPathForBoardDocument`). 서류 행·버전 행의 `file_path`는 둘 다 **접두 없이**
 *    저장된다 — 서류는 `<올린 사람 uuid>/<파일>`(앱에서 고쳤으면 `versions/<서류>/<버전>/<이름>`), 버전 행은 v1 의 옛 경로
 *    `<올린 사람>/<파일>`과 `versions/…` 경로.
 *  - 그래서 키에서 `board-documents/`를 떼어 `findReferencedBoardDocumentPaths`(두 칸 모두, 대소문자 무시)에 묻는다.
 *  - 뗀 값이 `isSafeBoardDocumentFilePath`/`isSafeBoardDocumentVersionPath`를 지나지 못하면 후보에서 뺀다.
 *  - 시드 서류 폴더(`seed/…`)는 늘 "가리킨다"로 본다 — `uploaded_by`가 없는 원본 서류가 산다.
 *
 * 내 문서함 고아 청소(`sweepMemberDocumentOrphans`)와 같은 틀이다: 48시간 지난 것만, 쪽 수·지우는 수·시간에 상한(남은 건
 * 다음 실행이 이어서), 그리고 대량 삭제 차단기(`OrphanSweepAbortedError`).
 */

const ORPHAN_MIN_AGE_MS = 48 * 3600 * 1000
const ORPHAN_MAX_PAGES = 20
const ORPHAN_MAX_REMOVALS = 500
const ORPHAN_BUDGET_MS = 30_000
/**
 * 대량 삭제 차단기 — 한 페이지에서 이만큼 이상, 그리고 훑은 오래된 객체의 절반 넘게 "행 없음"이면 **지우지 않고 멈춘다.**
 * 정상 운영에서 고아는 드물다. 그 비율이 높다면 DB 와 저장소가 다른 환경이다(빈 로컬 DB 에 운영 토큰 등).
 */
const ORPHAN_BREAKER_MIN = 20

const SEED_OWNER = 'seed'
const PREFIX = `${BOARD_DOCUMENT_PREFIX}/`

export type BoardDocumentOrphanSweepResult = {
  /** 훑은 객체 수 */
  scanned: number
  removed: number
  /** 상한(쪽 수·지우는 수·시간)에 걸려 멈췄다 — 다음 실행이 이어서 한다 */
  capped: boolean
}

export type BoardDocumentOrphanSweepDeps = {
  listPage?: typeof listBoardDocumentObjectsPage
  findReferenced?: typeof findReferencedBoardDocumentPaths
  remove?: (pathnames: string[]) => Promise<void>
  clock?: () => number
}

/**
 * 객체 키 → 청소 후보로 볼 `file_path`(접두를 뗀 값). 후보가 아니면 null — 접두 밖·봉쇄 판정 밖·시드 폴더.
 * 고아 판정의 경로 대응을 한 곳에 둔다(시험이 직접 본다).
 */
export function boardDocumentOrphanCandidatePath(pathname: unknown): string | null {
  if (typeof pathname !== 'string' || !pathname.startsWith(PREFIX)) return null
  const filePath = pathname.slice(PREFIX.length)
  if (!isSafeBoardDocumentFilePath(filePath) && !isSafeBoardDocumentVersionPath(filePath)) {
    return null
  }
  if (filePath.split('/')[0].toLowerCase() === SEED_OWNER) return null
  return filePath
}

/** 행 없는 서류 객체를 지운다. 훑는 양·지우는 양·시간에 상한 — 남은 건 다음 실행이 이어서 한다 */
export async function sweepBoardDocumentOrphans(
  now: Date,
  deps: BoardDocumentOrphanSweepDeps = {}
): Promise<BoardDocumentOrphanSweepResult> {
  const listPage = deps.listPage ?? listBoardDocumentObjectsPage
  const findReferenced = deps.findReferenced ?? findReferencedBoardDocumentPaths
  const remove = deps.remove ?? removeBoardDocumentObjects
  const clock = deps.clock ?? Date.now
  const started = clock()
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS
  let scanned = 0
  let removed = 0
  let capped = false
  let cursor: string | undefined
  for (let page = 0; ; page++) {
    if (page >= ORPHAN_MAX_PAGES || removed >= ORPHAN_MAX_REMOVALS) {
      capped = true
      break
    }
    if (clock() - started >= ORPHAN_BUDGET_MS) {
      capped = true
      break
    }
    const res = await listPage(cursor)
    const old: string[] = []
    for (const o of res.objects) {
      scanned++
      const filePath = boardDocumentOrphanCandidatePath(o.pathname)
      if (!filePath) continue
      const at = o.uploadedAt instanceof Date ? o.uploadedAt.getTime() : NaN
      // 시각을 모르거나 48시간이 안 됐으면(올리는 중·등록·승격 전) 건드리지 않는다
      if (!Number.isFinite(at) || at >= cutoff) continue
      old.push(filePath)
    }
    if (old.length > 0) {
      const referenced = await findReferenced(old)
      const orphanAll = old.filter(p => !referenced.has(p))
      if (orphanAll.length >= ORPHAN_BREAKER_MIN && orphanAll.length * 2 > old.length) {
        throw new OrphanSweepAbortedError(orphanAll.length, old.length)
      }
      const orphans = orphanAll.slice(0, ORPHAN_MAX_REMOVALS - removed)
      if (orphans.length > 0) {
        await remove(orphans.map(p => `${PREFIX}${p}`))
        removed += orphans.length
      }
    }
    if (!res.hasMore || !res.cursor) break
    cursor = res.cursor
  }
  return { scanned, removed, capped }
}
