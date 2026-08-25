import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  sha256,
  assertWithinBoardDocumentPrefix,
  resolveTargetPath,
  decideCopyAction,
  listAllBoardDocumentObjects,
  downloadSourceObject,
  inspectExistingTarget,
  writeTarget,
  planAndMaybeApply,
} = await import('../migrate/copy-private-objects.mjs')

// 이 스위트의 초점은 경로 봉쇄와 덮어쓰기 방지다. 같은 비공개 Blob 저장소
// `backups/` 아래 조합 DB 전체 덤프(회원 개인정보·bcrypt 해시)가 산다 —
// 이사회 문서 복사 경로가 새면 그쪽으로 이어질 수 있다는 뜻이다. 그래서
// 부정 대조(경로 이탈·임의 경로·체크섬 불일치·덮어쓰기·재검증 실패)를
// 가장 두껍게 둔다.

const UUID = '9f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d'

function fakeBlob(bytes, type = 'application/pdf') {
  return new Blob([bytes], { type })
}

/**
 * `board-documents` 버킷을 2단계(owner 폴더 → 파일)로 흉내 낸다.
 * `objectsByPath`의 키는 `<owner>/<file>` 전체 경로다. `extraRootEntries`·
 * `extraFolderEntries`로 버킷 구조를 벗어난 항목(루트 직속 파일, 폴더 안의
 * 또 다른 폴더, `.emptyFolderPlaceholder`)을 주입해 그 처리를 검증한다.
 */
function makeFakeSupabase(objectsByPath, { extraRootEntries = [], extraFolderEntries = {} } = {}) {
  const folders = new Map()
  for (const path of Object.keys(objectsByPath)) {
    const idx = path.indexOf('/')
    const folder = path.slice(0, idx)
    const name = path.slice(idx + 1)
    if (!folders.has(folder)) folders.set(folder, [])
    folders
      .get(folder)
      .push({ id: 'file-id', name, metadata: { size: objectsByPath[path].length } })
  }

  return {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'board-documents')
        return {
          async list(prefix) {
            if (prefix === '') {
              const folderEntries = [...folders.keys()].map(name => ({
                id: null,
                name,
                metadata: null,
              }))
              return { data: [...folderEntries, ...extraRootEntries], error: null }
            }
            return {
              data: [...(folders.get(prefix) ?? []), ...(extraFolderEntries[prefix] ?? [])],
              error: null,
            }
          },
          async download(filePath) {
            const bytes = objectsByPath[filePath]
            if (!bytes) return { data: null, error: { message: 'not found' } }
            return { data: fakeBlob(bytes), error: null }
          },
        }
      },
    },
  }
}

/**
 * 인메모리 비공개 Blob 스토어 흉내. 실제 `@vercel/blob`처럼 `allowOverwrite`가
 * false인데 목적지에 이미 뭔가 있으면 거부한다(경합 상황 재현용) — 이전
 * 버전은 옵션 값만 단언하고 그대로 덮어써서 "판정과 쓰기 사이의 경합을
 * 막는다"는 주장이 테스트로 증명되지 않았다.
 */
function makeFakeBlobStore(seed = {}) {
  const store = new Map(Object.entries(seed))
  const putCalls = []
  const getFn = async (pathname, opts) => {
    assert.equal(opts.access, 'private')
    // 캐시된 옛 바이트를 보고 재검증이 오판하지 않도록 항상 원본을 직접
    // 읽어야 한다 — 이 옵션이 실제로 요청되는지 모든 호출에서 확인한다.
    assert.equal(opts.useCache, false)
    if (!store.has(pathname)) return null
    const buf = store.get(pathname)
    return { statusCode: 200, stream: new Response(buf).body, contentType: 'application/pdf' }
  }
  const putFn = async (pathname, buffer, opts) => {
    assert.equal(opts.access, 'private')
    assert.equal(opts.addRandomSuffix, false)
    assert.equal(opts.allowOverwrite, false)
    if (store.has(pathname)) {
      throw new Error(`허용되지 않은 덮어쓰기 시도(이미 존재함): ${pathname}`)
    }
    putCalls.push({ pathname, opts })
    store.set(pathname, buffer)
    return { url: `https://fake.blob/${pathname}`, pathname }
  }
  return { store, putCalls, getFn, putFn }
}

// ------------------------------------------------------------- 경로 봉쇄

test('assertWithinBoardDocumentPrefix: 정상 경로는 통과한다', () => {
  assert.equal(
    assertWithinBoardDocumentPrefix('board-documents/seed/doc_0.pdf'),
    'board-documents/seed/doc_0.pdf'
  )
})

test('assertWithinBoardDocumentPrefix: backups/ 로는 절대 못 쓴다', () => {
  assert.throws(() => assertWithinBoardDocumentPrefix('backups/20260813.sql.gz'), /backups/)
  assert.throws(
    () => assertWithinBoardDocumentPrefix('board-documents/backups/x'),
    /backups/,
    '접두어 안쪽에 섞여 들어간 backups/도 막는다'
  )
})

test('assertWithinBoardDocumentPrefix: blobPathForBoardDocument가 만들지 않은 임의 경로를 거부한다', () => {
  assert.throws(() => assertWithinBoardDocumentPrefix('random-bucket/x.pdf'), /허용된 접두어/)
  assert.throws(() => assertWithinBoardDocumentPrefix('attachments/seed/x.pdf'), /허용된 접두어/)
  assert.throws(() => assertWithinBoardDocumentPrefix(''), /빈 대상 경로/)
  assert.throws(() => assertWithinBoardDocumentPrefix(null), /빈 대상 경로/)
})

test('resolveTargetPath: 정상 시드 경로를 board-documents/ 아래로 매핑한다', () => {
  assert.equal(resolveTargetPath('seed/doc_0.pdf'), 'board-documents/seed/doc_0.pdf')
})

test('resolveTargetPath: 정상 업로더 UUID 경로도 매핑한다(seed 전용이 아니다)', () => {
  assert.equal(
    resolveTargetPath(`${UUID}/1750000000000_계약서.pdf`),
    `board-documents/${UUID}/1750000000000_계약서.pdf`
  )
})

test('resolveTargetPath: 경로 이탈 시도는 blobPathForBoardDocument 단계에서 던진다', () => {
  assert.throws(() => resolveTargetPath('seed/../backups/x'), /안전하지 않은 이사회 문서 경로/)
  assert.throws(() => resolveTargetPath('../backups/x'), /안전하지 않은 이사회 문서 경로/)
  assert.throws(() => resolveTargetPath('backups/x'), /안전하지 않은 이사회 문서 경로/)
})

// --------------------------------------------------------- 복사 판정(순수)

test('decideCopyAction: 목적지가 비어 있으면 copy', () => {
  assert.equal(decideCopyAction({ sourceHash: 'h', sourceSize: 10, existing: null }), 'copy')
})

test('decideCopyAction: 이미 같은 내용이 있으면 skip(멱등)', () => {
  const action = decideCopyAction({
    sourceHash: 'h',
    sourceSize: 10,
    existing: { size: 10, hash: 'h' },
  })
  assert.equal(action, 'skip')
})

test('decideCopyAction: 체크섬이 다르면 던진다(크기는 같아도)', () => {
  assert.throws(
    () =>
      decideCopyAction({
        sourceHash: 'h-new',
        sourceSize: 10,
        existing: { size: 10, hash: 'h-old' },
      }),
    /덮어쓰기 위험/
  )
})

test('decideCopyAction: 크기가 다르면 던진다(체크섬을 계산하기 전에도)', () => {
  assert.throws(
    () =>
      decideCopyAction({
        sourceHash: 'h',
        sourceSize: 999,
        existing: { size: 10, hash: 'h' },
      }),
    /덮어쓰기 위험/
  )
})

// ----------------------------------------------------------------- 목록

test('listAllBoardDocumentObjects: seed/와 <uuid>/ 를 모두 대상으로 삼는다(커버리지 후퇴 방지)', async () => {
  // 실제 업로드 경로는 seed/가 아니라 <uploader-uuid>/다
  // (src/app/api/board-room/documents/route.ts:120). seed/만 보면 컷오버
  // 직전 새로 올라온 문서를 영원히 놓친다 — 그 재발을 막는 테스트다.
  const supabase = makeFakeSupabase({
    'seed/doc_0.pdf': Buffer.from('a'),
    [`${UUID}/1750000000000_계약서.pdf`]: Buffer.from('bb'),
  })
  const objs = await listAllBoardDocumentObjects(supabase)
  assert.deepEqual(
    objs.map(o => o.filePath).sort(),
    [`${UUID}/1750000000000_계약서.pdf`, 'seed/doc_0.pdf'].sort()
  )
})

test('listAllBoardDocumentObjects: .emptyFolderPlaceholder는 문서로 취급하지 않는다', async () => {
  const supabase = makeFakeSupabase(
    { 'seed/doc_0.pdf': Buffer.from('a') },
    {
      extraFolderEntries: {
        seed: [{ id: 'ph', name: '.emptyFolderPlaceholder', metadata: { size: 0 } }],
      },
    }
  )
  const objs = await listAllBoardDocumentObjects(supabase)
  assert.deepEqual(
    objs.map(o => o.filePath),
    ['seed/doc_0.pdf']
  )
})

test('listAllBoardDocumentObjects: 루트에 폴더가 아닌 파일이 섞이면 던진다', async () => {
  const supabase = makeFakeSupabase(
    { 'seed/doc_0.pdf': Buffer.from('a') },
    { extraRootEntries: [{ id: 'rogue-id', name: 'rogue.pdf', metadata: { size: 1 } }] }
  )
  await assert.rejects(() => listAllBoardDocumentObjects(supabase), /예상하지 못한 루트 파일/)
})

test('listAllBoardDocumentObjects: 폴더 안에 또 폴더가 있으면(예상 밖 중첩) 던진다', async () => {
  const supabase = makeFakeSupabase(
    { 'seed/doc_0.pdf': Buffer.from('a') },
    { extraFolderEntries: { seed: [{ id: null, name: 'nested-dir', metadata: null }] } }
  )
  await assert.rejects(() => listAllBoardDocumentObjects(supabase), /예상하지 못한 하위 폴더/)
})

test('listAllBoardDocumentObjects: 루트가 1000건에 도달하면 페이지네이션 미구현으로 던진다', async () => {
  const objectsByPath = {}
  for (let i = 0; i < 1000; i++) objectsByPath[`owner-${i}/doc.pdf`] = Buffer.from('x')
  const supabase = makeFakeSupabase(objectsByPath)
  await assert.rejects(() => listAllBoardDocumentObjects(supabase), /루트가 1000건에 도달/)
})

test('listAllBoardDocumentObjects: 한 폴더 안이 1000건에 도달하면 페이지네이션 미구현으로 던진다', async () => {
  const objectsByPath = {}
  for (let i = 0; i < 1000; i++) objectsByPath[`seed/doc_${i}.pdf`] = Buffer.from('x')
  const supabase = makeFakeSupabase(objectsByPath)
  await assert.rejects(() => listAllBoardDocumentObjects(supabase), /1000건에 도달/)
})

// -------------------------------------------------------------- 다운로드

test('downloadSourceObject: 크기·SHA-256·contentType을 계산한다', async () => {
  const bytes = Buffer.from('hello board room')
  const supabase = makeFakeSupabase({ 'seed/doc_0.pdf': bytes })
  const result = await downloadSourceObject(supabase, 'seed/doc_0.pdf')
  assert.equal(result.size, bytes.length)
  assert.equal(result.hash, sha256(bytes))
  assert.equal(result.contentType, 'application/pdf')
})

test('downloadSourceObject: 없는 파일이면 던진다', async () => {
  const supabase = makeFakeSupabase({})
  await assert.rejects(() => downloadSourceObject(supabase, 'seed/missing.pdf'), /다운로드 실패/)
})

// ------------------------------------------------------------ 목적지 조회

test('inspectExistingTarget: 없으면 null', async () => {
  const { getFn } = makeFakeBlobStore()
  const result = await inspectExistingTarget('board-documents/seed/doc_0.pdf', {
    blobToken: 't',
    getFn,
  })
  assert.equal(result, null)
})

test('inspectExistingTarget: 있으면 크기·해시를 계산한다', async () => {
  const bytes = Buffer.from('existing content')
  const { getFn } = makeFakeBlobStore({ 'board-documents/seed/doc_0.pdf': bytes })
  const result = await inspectExistingTarget('board-documents/seed/doc_0.pdf', {
    blobToken: 't',
    getFn,
  })
  assert.deepEqual(result, { size: bytes.length, hash: sha256(bytes) })
})

test('inspectExistingTarget: 캐시를 끄고 조회한다(useCache: false)', async () => {
  let seenOpts
  const getFn = async (pathname, opts) => {
    seenOpts = opts
    return null
  }
  await inspectExistingTarget('board-documents/seed/doc_0.pdf', { blobToken: 't', getFn })
  assert.equal(seenOpts.useCache, false)
})

// ------------------------------------------------------------------ 쓰기

test('writeTarget: 정상 경로면 private 옵션으로 putFn을 부른다', async () => {
  const { putFn, putCalls } = makeFakeBlobStore()
  const bytes = Buffer.from('doc')
  await writeTarget('board-documents/seed/doc_0.pdf', bytes, 'application/pdf', {
    blobToken: 't',
    putFn,
  })
  assert.equal(putCalls.length, 1)
  assert.equal(putCalls[0].pathname, 'board-documents/seed/doc_0.pdf')
})

test('writeTarget: backups/ 경로로는 putFn을 부르기 전에 던진다', async () => {
  const { putFn, putCalls } = makeFakeBlobStore()
  await assert.rejects(
    () =>
      writeTarget('backups/20260813.sql.gz', Buffer.from('x'), 'application/gzip', {
        blobToken: 't',
        putFn,
      }),
    /backups/
  )
  assert.equal(putCalls.length, 0, 'putFn이 호출되지 않아야 한다')
})

test('writeTarget: 목적지에 이미 다른 내용이 있으면(경합) SDK 수준에서도 거부된다', async () => {
  const original = Buffer.from('someone else wrote this between check and write')
  const { putFn, store } = makeFakeBlobStore({ 'board-documents/seed/doc_0.pdf': original })
  await assert.rejects(
    () =>
      writeTarget('board-documents/seed/doc_0.pdf', Buffer.from('our content'), 'application/pdf', {
        blobToken: 't',
        putFn,
      }),
    /허용되지 않은 덮어쓰기/
  )
  // 경합에서 거부됐으니 원래 있던 내용이 그대로 남아 있어야 한다.
  assert.deepEqual(store.get('board-documents/seed/doc_0.pdf'), original)
})

// ------------------------------------------------------- 전체 흐름(오케스트레이션)

test('planAndMaybeApply: dry-run은 아무것도 쓰지 않는다', async () => {
  const supabase = makeFakeSupabase({ 'seed/doc_0.pdf': Buffer.from('a') })
  const { putFn, putCalls } = makeFakeBlobStore()
  const getFn = async () => null

  const results = await planAndMaybeApply({
    supabase,
    blobToken: 't',
    apply: false,
    log: () => {},
    getFn,
    putFn,
  })

  assert.equal(results.length, 1)
  assert.equal(results[0].action, 'copy')
  assert.equal(putCalls.length, 0, 'dry-run은 putFn을 호출하면 안 된다')
})

test('planAndMaybeApply: apply는 실제로 복사하고, 같은 입력을 다시 돌리면 멱등하게 건너뛴다', async () => {
  const bytes = Buffer.from('board document content')
  const supabase = makeFakeSupabase({ 'seed/doc_0.pdf': bytes })
  const { getFn, putFn, putCalls } = makeFakeBlobStore()

  const first = await planAndMaybeApply({
    supabase,
    blobToken: 't',
    apply: true,
    log: () => {},
    getFn,
    putFn,
  })
  assert.equal(first[0].action, 'copy')
  assert.equal(putCalls.length, 1)

  const second = await planAndMaybeApply({
    supabase,
    blobToken: 't',
    apply: true,
    log: () => {},
    getFn,
    putFn,
  })
  assert.equal(second[0].action, 'skip')
  assert.equal(putCalls.length, 1, '두 번째 실행에서는 다시 쓰지 않아야 한다(멱등)')
})

test('planAndMaybeApply: 목적지에 다른 내용이 이미 있으면 덮어쓰지 않고 던진다', async () => {
  const supabase = makeFakeSupabase({ 'seed/doc_0.pdf': Buffer.from('new content') })
  const { getFn, putFn, putCalls } = makeFakeBlobStore({
    'board-documents/seed/doc_0.pdf': Buffer.from('DIFFERENT old content'),
  })

  await assert.rejects(
    () => planAndMaybeApply({ supabase, blobToken: 't', apply: true, log: () => {}, getFn, putFn }),
    /덮어쓰기 위험/
  )
  assert.equal(putCalls.length, 0, '충돌이 감지되면 putFn을 호출해선 안 된다')
})

test('planAndMaybeApply: seed/ 밖으로 이탈하는 파일명이 섞여 있으면 전체를 중단한다(backups/ 방어)', async () => {
  // Supabase 버킷 목록에 어쩌다 이런 이름이 섞여도(예: 손상된 메타데이터,
  // 악의적 업로드) 경로 봉쇄가 이 시점에서 걸려야 한다 — 실제로 무언가를
  // 쓰기 전에. 파일명이 아니라 owner 폴더명 자체가 안전 목록(seed/UUID)을
  // 벗어나는 경우로 흉내낸다.
  const supabase = makeFakeSupabase({
    '../../backups/20260813.sql.gz': Buffer.from('would-be-a-db-dump'),
  })
  const { getFn, putFn, putCalls } = makeFakeBlobStore()

  await assert.rejects(
    () => planAndMaybeApply({ supabase, blobToken: 't', apply: true, log: () => {}, getFn, putFn }),
    /안전하지 않은 이사회 문서 경로/
  )
  assert.equal(putCalls.length, 0)
})

test('planAndMaybeApply: Supabase 목록 크기와 실제 다운로드 크기가 다르면 던진다', async () => {
  const supabase = {
    storage: {
      from: () => ({
        async list(prefix) {
          if (prefix === '')
            return { data: [{ id: null, name: 'seed', metadata: null }], error: null }
          return {
            data: [{ id: 'x', name: 'doc_0.pdf', metadata: { size: 999999 } }],
            error: null,
          }
        },
        async download() {
          return { data: fakeBlob(Buffer.from('actual small content')), error: null }
        },
      }),
    },
  }
  const { getFn, putFn } = makeFakeBlobStore()
  await assert.rejects(
    () =>
      planAndMaybeApply({ supabase, blobToken: 't', apply: false, log: () => {}, getFn, putFn }),
    /목록 크기.*다운로드 크기/
  )
})

// --------------------------------------------------- apply 이후 재검증(Important 3)

test('planAndMaybeApply: 쓰기가 조용히 아무것도 저장하지 않으면(성공을 보고해도) 재검증이 잡아낸다', async () => {
  const supabase = makeFakeSupabase({ 'seed/doc_0.pdf': Buffer.from('real content') })
  const { getFn } = makeFakeBlobStore()
  // SDK가 예외 없이 성공을 돌려주지만 실제로는 아무것도 저장하지 않는
  // 상황을 흉내낸다(예: 네트워크 중간에서 조용히 드롭됨).
  const silentlyFailingPutFn = async () => ({ url: 'https://fake.blob/x', pathname: 'x' })

  await assert.rejects(
    () =>
      planAndMaybeApply({
        supabase,
        blobToken: 't',
        apply: true,
        log: () => {},
        getFn,
        putFn: silentlyFailingPutFn,
      }),
    /복사 후 재검증 실패/
  )
})

test('planAndMaybeApply: 쓰여진 내용이 소스와 다르면(전송 중 손상) 재검증이 잡아낸다', async () => {
  const supabase = makeFakeSupabase({ 'seed/doc_0.pdf': Buffer.from('real content') })
  const { getFn, putFn } = makeFakeBlobStore()
  const corruptingPutFn = async (pathname, _buffer, opts) =>
    putFn(pathname, Buffer.from('CORRUPTED'), opts)

  await assert.rejects(
    () =>
      planAndMaybeApply({
        supabase,
        blobToken: 't',
        apply: true,
        log: () => {},
        getFn,
        putFn: corruptingPutFn,
      }),
    /복사 후 재검증 실패/
  )
})

test('planAndMaybeApply: 정상적으로 쓰이면 재검증도 조용히 통과한다(로그로 확인)', async () => {
  const supabase = makeFakeSupabase({ 'seed/doc_0.pdf': Buffer.from('real content') })
  const { getFn, putFn } = makeFakeBlobStore()
  const logs = []

  const results = await planAndMaybeApply({
    supabase,
    blobToken: 't',
    apply: true,
    log: msg => logs.push(msg),
    getFn,
    putFn,
  })

  assert.equal(results[0].action, 'copy')
  assert.ok(
    logs.some(l => l.includes('재검증 완료')),
    '재검증 완료 로그가 있어야 한다'
  )
})
