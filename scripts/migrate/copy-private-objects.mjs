/**
 * 단계 4 나머지 작업 — 비공개 스토리지 이관.
 *
 * Supabase Storage `board-documents` 버킷 전체(모든 `<owner>/<file>` 폴더)를
 * 비공개 Blob 저장소로 복사·대조하는 도구다. board_documents 표 자체(14행)는
 * 이 스크립트가 아니라 scripts/migrate/stage4.mjs가 Turso로 옮긴다 — 여기서는
 * 파일 실물만 다룬다.
 *
 * **복사 겸 대조 도구다.** `--apply` 없이 돌리면(기본값) 아무것도 쓰지 않고
 * 소스 전체를 내려받아 SHA-256을 계산하고, 목적지에 이미 있는 것과 대조한다 —
 * 이게 곧 "전수 검증"이다(코드 경로가 복사 판정과 완전히 같다). `--apply`를
 * 주면 실제로 쓰되, 쓴 직후 같은 경로를 다시 읽어(캐시를 끄고) 방금 쓴
 * 바이트가 소스와 정말 같은지 그 실행 안에서 재확인한다.
 *
 * **버킷 전체를 훑는 이유(2단계 폭 탐색).** 이 버킷 구조는 `<owner>/<file>`
 * 두 단계다. `owner`는 시드 문서의 리터럴 `seed`이거나, 조합원이 실제로
 * 올린 문서의 업로더 UUID다(`src/app/api/board-room/documents/route.ts:120`
 * `const storagePath = \`${user.id}/${Date.now()}_${safeName}\``). `seed/`
 * 한 접두어만 보면 컷오버 직전에 조합원이 새로 올린 문서(`<uuid>/` 아래)는
 * 영원히 못 본다 — 지금은 무해하다(루트에 `seed` 폴더 하나뿐)지만 그건
 * 데이터 우연이지 이 도구의 보장이 아니다. 그래서 루트를 먼저 나열해 폴더
 * 전부를 대상으로 삼는다.
 *
 * 경로 봉쇄가 이 스크립트의 보안 경계다. 같은 비공개 Blob 저장소
 * `backups/` 접두어 아래에 조합 DB 전체 덤프(회원 전원의 개인정보·bcrypt
 * 해시)가 함께 산다. 대상 경로는 반드시 `src/lib/storage/boardDocuments.ts`의
 * `blobPathForBoardDocument`가 만든 값만 쓰고, 쓰기 직전에 다시 한 번
 * `assertWithinBoardDocumentPrefix`로 확인한다 — 두 겹 방어다. 이 파일이
 * `blobPathForBoardDocument`를 우회해 문자열을 손으로 조립하도록 나중에
 * 리팩터되어도, 두 번째 게이트가 여전히 `backups/`로의 쓰기를 막는다.
 * 버킷 전체를 훑게 되어도 이 봉쇄는 느슨해지지 않는다 — `owner` 폴더명이
 * `seed`도 UUID도 아니면 `blobPathForBoardDocument`(정확히는 그 안의
 * `isSafeBoardDocumentFilePath`)가 그 즉시 던진다.
 *
 * 예전에 `scripts/storage/copy-board-documents.mjs`(2026-08-14)가 이미
 * 비슷한 일을 했었다. 그 스크립트는 삭제했다(git 이력 `ef637ed`·`b514629`에
 * 남아 있다) — 인자 없이 실행하면 기본값이 실제 쓰기였고, 경로 봉쇄 모듈을
 * 전혀 쓰지 않고 접두어 문자열을 중복 정의했으며, 덮어쓰기 판정이 존재
 * 여부만 봐서 목적지가 손상돼 있어도 조용히 건너뛰었다. 이 스크립트는 그
 * 세 가지를 전부 고쳤다: 기본값은 dry-run, 경로는 오직
 * `blobPathForBoardDocument`로만 만들고, 스킵 판정은 크기+SHA-256 완전
 * 일치일 때만 한다.
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { get, put } from '@vercel/blob'
import {
  BOARD_DOCUMENT_PREFIX,
  blobPathForBoardDocument,
} from '../../src/lib/storage/boardDocuments.ts'

const SOURCE_BUCKET = 'board-documents'
const EMPTY_FOLDER_PLACEHOLDER = '.emptyFolderPlaceholder'

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
 * 조립하지 않는다 — 그 함수가 안전하지 않은 입력에서 던진다. `owner`가
 * `seed`도 UUID도 아니면(버킷 구조를 벗어난 폴더명이면) 여기서 막힌다.
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

/** 버킷 한 폴더(`owner/`) 아래 파일 목록. 플레이스홀더는 걷어낸다. */
async function listFolderFiles(supabase, folder) {
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).list(folder, { limit: 1000 })
  if (error) throw new Error(`${SOURCE_BUCKET}/${folder} 목록 조회 실패: ${error.message}`)
  const entries = data ?? []
  if (entries.length >= 1000) {
    throw new Error(`${SOURCE_BUCKET}/${folder}가 1000건에 도달했다. 페이지네이션을 구현해야 한다.`)
  }

  const files = []
  for (const entry of entries) {
    if (entry.name === EMPTY_FOLDER_PLACEHOLDER) continue // 빈 폴더 표식, 실제 문서가 아니다.
    if (entry.id === null) {
      // 이 버킷 구조는 정확히 2단계(owner/file)다. 폴더 안에 또 폴더가
      // 있으면 예상 밖 구조이므로 조용히 걷어내지 않고 던진다.
      throw new Error(`예상하지 못한 하위 폴더: ${SOURCE_BUCKET}/${folder}/${entry.name}`)
    }
    files.push({
      filePath: `${folder}/${entry.name}`,
      listedSize: entry.metadata?.size ?? null,
    })
  }
  return files
}

/**
 * Supabase `board-documents` 버킷 전체를 2단계로 훑는다: 루트에서 owner
 * 폴더 목록을 얻고, 각 폴더 안의 파일을 모은다. 루트에 폴더가 아닌 파일이
 * 직접 있으면(이 버킷 구조를 벗어난 상태) 조용히 넘어가지 않고 던진다.
 */
export async function listAllBoardDocumentObjects(supabase) {
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).list('', { limit: 1000 })
  if (error) throw new Error(`${SOURCE_BUCKET} 루트 목록 조회 실패: ${error.message}`)
  const rootEntries = data ?? []
  if (rootEntries.length >= 1000) {
    throw new Error(`${SOURCE_BUCKET} 루트가 1000건에 도달했다. 페이지네이션을 구현해야 한다.`)
  }

  const objects = []
  for (const entry of rootEntries) {
    if (entry.id !== null) {
      throw new Error(
        `예상하지 못한 루트 파일: ${SOURCE_BUCKET}/${entry.name} (owner 폴더가 아니다)`
      )
    }
    objects.push(...(await listFolderFiles(supabase, entry.name)))
  }
  return objects
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
 *
 * `useCache: false`를 명시한다 — 기본값은 CDN 캐시 사용인데, 이 함수는
 * `--apply` 직후 재검증과 롤백 후 대조에서도 쓰인다. 캐시가 옛 바이트를
 * 돌려주면 방금 쓴 내용이 실제로 올라갔는지 확인하는 재검증이 무의미해진다.
 */
export async function inspectExistingTarget(targetPath, { blobToken, getFn = get }) {
  const result = await getFn(targetPath, { access: 'private', token: blobToken, useCache: false })
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
 * 버킷 전체를 순회하며 각각 복사 여부를 판정하고, apply일 때만 실제로 쓴다.
 * apply로 실제로 복사한 파일은 쓴 직후 같은 경로를 다시 읽어(캐시 끄고)
 * 소스와 크기·해시가 여전히 같은지 그 실행 안에서 재확인한다 — 불일치면
 * 던진다. dry-run(apply=false)일 때는 그 자체가 이미 전수 대조다: 목적지에
 * 있는 모든 것을 소스와 크기·해시로 비교하고, 다르면 던진다.
 *
 * 파일별로 진행 상황을 로그로 남기되 내용은 절대 찍지 않는다 — 경로·크기·
 * 체크섬 접두 12자리까지만.
 */
export async function planAndMaybeApply({
  supabase,
  blobToken,
  apply,
  log = console.log,
  getFn = get,
  putFn = put,
}) {
  const sourceObjects = await listAllBoardDocumentObjects(supabase)
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

      // 쓴 직후 재읽기 — 캐시를 끈 채로 방금 쓴 바이트가 소스와 정말 같은지
      // 이 실행 안에서 확인한다. 체크섬 대조를 쓰기 전 판정에만 쓰고 끝내면
      // "복사가 온전한지 확인한다"는 요구를 충족하지 못한다.
      const verified = await inspectExistingTarget(targetPath, { blobToken, getFn })
      if (!verified || verified.size !== source.size || verified.hash !== source.hash) {
        throw new Error(
          `복사 후 재검증 실패: ${targetPath} — 방금 쓴 내용을 다시 읽었더니 소스와 다르다` +
            ` (검증 ${verified?.size ?? 'null'}B/${verified?.hash?.slice(0, 12) ?? 'null'}… vs 소스 ${source.size}B/${hashPrefix}…)`
        )
      }
      log(`  재검증 완료: ${targetPath} (${verified.size}B, sha256=${verified.hash.slice(0, 12)}…)`)
    }

    results.push({ filePath, targetPath, size: source.size, hash: source.hash, action })
  }

  return results
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

async function main() {
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
    console.log(
      'dry-run 모드(=전수 대조) — 아무것도 쓰지 않는다. 실제로 복사하려면 --apply를 넘겨라.\n'
    )
  }

  const results = await planAndMaybeApply({ supabase, blobToken, apply })

  const toCopy = results.filter(r => r.action === 'copy').length
  const toSkip = results.filter(r => r.action === 'skip').length
  console.log(
    `\n${apply ? '적용 완료(쓴 파일은 전부 재검증됨)' : 'dry-run 요약(=전수 대조 결과)'}: ` +
      `총 ${results.length}건, ${apply ? '복사' : '복사 대상'} ${toCopy}건, 건너뜀(이미 동일) ${toSkip}건`
  )
  if (apply) {
    console.log(
      '권장: 이 결과와 별개로, 시간이 지난 뒤 --apply 없이 한 번 더 돌려' +
        '(= npm run storage:verify-private) 전수 대조를 재확인해라.'
    )
  }
}

if (isMain) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
