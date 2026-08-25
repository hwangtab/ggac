/**
 * 단계 4 나머지 작업 — 비공개 스토리지 이관.
 *
 * Supabase Storage `board-documents` 버킷의 `seed/` 아래 객체를 비공개 Blob
 * 저장소로 복사한다. board_documents 표 자체(14행)는 이 스크립트가 아니라
 * scripts/migrate/stage4.mjs가 Turso로 옮긴다 — 여기서는 파일 실물만 다룬다.
 *
 * 경로 봉쇄가 이 스크립트의 보안 경계다. 같은 비공개 Blob 저장소
 * `backups/` 접두어 아래에 조합 DB 전체 덤프(회원 전원의 개인정보·bcrypt
 * 해시)가 함께 산다. 대상 경로는 반드시 `src/lib/storage/boardDocuments.ts`의
 * `blobPathForBoardDocument`가 만든 값만 쓰고, 쓰기 직전에 다시 한 번
 * `assertWithinBoardDocumentPrefix`로 확인한다 — 두 겹 방어다. 이 파일이
 * `blobPathForBoardDocument`를 우회해 문자열을 손으로 조립하도록 나중에
 * 리팩터되어도, 두 번째 게이트가 여전히 `backups/`로의 쓰기를 막는다.
 *
 * scripts/storage/copy-board-documents.mjs(2026-08-14, 단계 1a 시험용)와
 * 다르다 — 그 스크립트는 PREFIX 문자열을 중복 정의하고 봉쇄 함수를 전혀
 * 쓰지 않으며, 기본 동작이 실제 쓰기다(`--dry-run`을 줘야 안 쓴다). 이
 * 스크립트는 그 반대를 기본으로 한다: `--apply`를 명시해야만 쓴다.
 */
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { get, put } from '@vercel/blob'
import {
  BOARD_DOCUMENT_PREFIX,
  blobPathForBoardDocument,
} from '../../src/lib/storage/boardDocuments.ts'

const SOURCE_BUCKET = 'board-documents'
const SOURCE_PREFIX = 'seed'

export const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/**
 * 두 번째 경로 봉쇄 게이트. `blobPathForBoardDocument`는 이미 안전하지 않은
 * 입력에서 던지므로 정상 경로에서는 이 함수도 항상 통과한다. 그런데도 여기서
 * 다시 검사하는 이유는, 이 스크립트가 나중에 리팩터되며 그 함수를 거치지 않고
 * 문자열을 직접 조립하는 실수를 저질러도(예: 캐시된 경로 재사용, 상수 중복)
 * 쓰기 직전에 한 번 더 걸러내기 위해서다. `backups/`는 그 안에 부분 문자열로
 * 섞여 있어도(예: `board-documents/../backups/x`) 거부한다 — 정상 경로에는
 * 그 문자열이 등장할 이유가 전혀 없다.
 */
export function assertWithinBoardDocumentPrefix(pathname) {
  if (typeof pathname !== 'string' || !pathname) {
    throw new Error(`빈 대상 경로: ${String(pathname)}`)
  }
  if (!pathname.startsWith(`${BOARD_DOCUMENT_PREFIX}/`)) {
    throw new Error(`허용된 접두어(${BOARD_DOCUMENT_PREFIX}/) 밖의 경로다: ${pathname}`)
  }
  if (pathname.includes('backups/') || pathname.startsWith('backups')) {
    throw new Error(`backups/ 접두어로는 절대 쓸 수 없다: ${pathname}`)
  }
  return pathname
}

/**
 * 소스 파일(Supabase 쪽 `<owner>/<filename>` 상대 경로)에서 목적지 Blob
 * pathname을 계산한다. `blobPathForBoardDocument`만 쓰고 문자열을 손으로
 * 조립하지 않는다 — 그 함수가 안전하지 않은 입력에서 던진다.
 */
export function resolveTargetPath(filePath) {
  return assertWithinBoardDocumentPrefix(blobPathForBoardDocument(filePath))
}

/**
 * 복사 여부를 판정하는 순수 함수. 네트워크 없이 유닛 테스트로 전부 검증한다.
 *
 * - 목적지에 아무것도 없으면 복사한다.
 * - 목적지에 이미 있고 크기·체크섬이 소스와 완전히 같으면 건너뛴다 — 이전
 *   실행이 이미 옮겨둔 것이므로 다시 쓸 필요가 없다(멱등).
 * - 목적지에 이미 있는데 크기나 체크섬이 다르면 절대 조용히 덮어쓰지 않고
 *   던진다 — 우리가 옮기려는 문서가 아닌 다른 무언가를 밟을 위험이다.
 */
export function decideCopyAction({ sourceHash, sourceSize, existing }) {
  if (!existing) return 'copy'
  if (existing.size === sourceSize && existing.hash === sourceHash) return 'skip'
  throw new Error(
    `덮어쓰기 위험: 목적지에 이미 다른 내용의 객체가 있다 ` +
      `(기존 ${existing.size}B/${String(existing.hash).slice(0, 12)}… vs 소스 ${sourceSize}B/${sourceHash.slice(0, 12)}…)`
  )
}

/** Supabase `board-documents` 버킷의 `seed/` 아래 객체 목록. */
export async function listSeedObjects(supabase) {
  const { data, error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .list(SOURCE_PREFIX, { limit: 1000 })
  if (error) throw new Error(`Supabase 목록 조회 실패: ${error.message}`)
  const entries = data ?? []
  if (entries.length >= 1000) {
    throw new Error(
      `${SOURCE_BUCKET}/${SOURCE_PREFIX}가 1000건에 도달했다. 페이지네이션을 구현해야 한다.`
    )
  }
  return entries
    .filter(entry => entry.id !== null) // 하위 폴더는 이 버킷 구조상 나오면 안 된다.
    .map(entry => ({
      filePath: `${SOURCE_PREFIX}/${entry.name}`,
      listedSize: entry.metadata?.size ?? null,
    }))
}

/** 소스 객체 바이트를 받아 크기·SHA-256까지 계산해 돌려준다. */
export async function downloadSourceObject(supabase, filePath) {
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).download(filePath)
  if (error || !data) {
    throw new Error(`${filePath}: 원본 다운로드 실패 ${error?.message ?? 'no data'}`)
  }
  const buffer = Buffer.from(await data.arrayBuffer())
  return {
    buffer,
    contentType: data.type || 'application/octet-stream',
    size: buffer.length,
    hash: sha256(buffer),
  }
}

/**
 * 목적지에 이미 있는 객체를 읽어 크기·체크섬을 계산한다. 없으면 null.
 * `get()`은 없는 pathname에서 예외 없이 null을 돌려주므로(공식 문서 보장)
 * head()의 not-found 예외 타입을 따로 다룰 필요가 없다.
 */
export async function inspectExistingTarget(targetPath, { blobToken, getFn = get }) {
  const result = await getFn(targetPath, { access: 'private', token: blobToken })
  if (!result || !result.stream) return null
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer())
  return { size: buffer.length, hash: sha256(buffer) }
}

/** 실제 쓰기. 호출 직전에 두 번째 경로 게이트를 다시 통과시킨다. */
export async function writeTarget(targetPath, buffer, contentType, { blobToken, putFn = put }) {
  assertWithinBoardDocumentPrefix(targetPath)
  await putFn(targetPath, buffer, {
    access: 'private',
    token: blobToken,
    addRandomSuffix: false,
    // decideCopyAction이 'copy'를 돌려줄 때는 이미 목적지가 비어 있음을
    // 확인한 뒤다. 그런데도 SDK 기본 관용(조용한 덮어쓰기 금지)을 명시적으로
    // 유지한다 — 이 사이에 다른 프로세스가 같은 경로에 썼다면 그건 정말로
    // 실패해야 하는 경합이다.
    allowOverwrite: false,
    contentType,
  })
}

/**
 * 소스 14개(설계 시점 기준)를 순회하며 각각 복사 여부를 판정하고, apply일
 * 때만 실제로 쓴다. 파일별로 진행 상황을 로그로 남기되 내용은 절대 찍지
 * 않는다 — 경로·크기·체크섬 접두 12자리까지만.
 */
export async function planAndMaybeApply({
  supabase,
  blobToken,
  apply,
  log = console.log,
  getFn = get,
  putFn = put,
}) {
  const sourceObjects = await listSeedObjects(supabase)
  const results = []

  for (const { filePath, listedSize } of sourceObjects) {
    const targetPath = resolveTargetPath(filePath)
    const source = await downloadSourceObject(supabase, filePath)

    if (listedSize !== null && listedSize !== source.size) {
      throw new Error(
        `${filePath}: 목록 크기(${listedSize})와 실제 다운로드 크기(${source.size})가 다르다`
      )
    }

    const existing = await inspectExistingTarget(targetPath, { blobToken, getFn })
    const action = decideCopyAction({
      sourceHash: source.hash,
      sourceSize: source.size,
      existing,
    })

    const hashPrefix = source.hash.slice(0, 12)
    const label = !apply ? `(dry-run) ${action}` : action === 'copy' ? '복사' : '건너뜀(이미 동일)'
    log(`${label}: ${filePath} -> ${targetPath} (${source.size}B, sha256=${hashPrefix}…)`)

    if (apply && action === 'copy') {
      await writeTarget(targetPath, source.buffer, source.contentType, { blobToken, putFn })
    }

    results.push({ filePath, targetPath, size: source.size, hash: source.hash, action })
  }

  return results
}

const isMain = process.argv[1]?.endsWith('copy-private-objects.mjs')
if (isMain) {
  const apply = process.argv.includes('--apply')

  const blobToken = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN
  if (!blobToken) throw new Error('PRIVATE_BLOB_READ_WRITE_TOKEN이 필요하다')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요하다')
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  if (!apply) {
    console.log('dry-run 모드 — 아무것도 쓰지 않는다. 실제로 복사하려면 --apply를 넘겨라.\n')
  }

  const results = await planAndMaybeApply({ supabase, blobToken, apply })

  const toCopy = results.filter(r => r.action === 'copy').length
  const toSkip = results.filter(r => r.action === 'skip').length
  console.log(
    `\n${apply ? '적용 완료' : 'dry-run 요약'}: 총 ${results.length}건, ` +
      `${apply ? '복사' : '복사 대상'} ${toCopy}건, 건너뜀(이미 동일) ${toSkip}건`
  )
}
