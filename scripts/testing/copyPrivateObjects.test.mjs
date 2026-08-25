import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  sha256,
  assertWithinBoardDocumentPrefix,
  resolveTargetPath,
  decideCopyAction,
  listSeedObjects,
  downloadSourceObject,
  inspectExistingTarget,
  writeTarget,
  planAndMaybeApply,
} = await import('../migrate/copy-private-objects.mjs')

// 이 스위트의 초점은 경로 봉쇄와 덮어쓰기 방지다. 같은 비공개 Blob 저장소
// `backups/` 아래 조합 DB 전체 덤프(회원 개인정보·bcrypt 해시)가 산다 —
// 이사회 문서 복사 경로가 새면 그쪽으로 이어질 수 있다는 뜻이다. 그래서
// 부정 대조(경로 이탈·임의 경로·체크섬 불일치·덮어쓰기)를 가장 두껍게 둔다.

function fakeBlob(bytes, type = 'application/pdf') {
  return new Blob([bytes], { type })
}

function makeFakeSupabase(objectsByPath) {
  return {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'board-documents')
        return {
          async list(prefix) {
            const entries = Object.keys(objectsByPath)
              .filter(p => p.startsWith(`${prefix}/`))
              .map(p => ({
                id: 'file-id',
                name: p.slice(prefix.length + 1),
                metadata: { size: objectsByPath[p].length },
              }))
            return { data: entries, error: null }
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

/** 인메모리 비공개 Blob 스토어 흉내. get/put만 흉내 내면 충분하다. */
function makeFakeBlobStore(seed = {}) {
  const store = new Map(Object.entries(seed))
  const putCalls = []
  const getFn = async (pathname, opts) => {
    assert.equal(opts.access, 'private')
    if (!store.has(pathname)) return null
    const buf = store.get(pathname)
    return { statusCode: 200, stream: new Response(buf).body, contentType: 'application/pdf' }
  }
  const putFn = async (pathname, buffer, opts) => {
    putCalls.push({ pathname, opts })
    assert.equal(opts.access, 'private')
    assert.equal(opts.addRandomSuffix, false)
    assert.equal(opts.allowOverwrite, false)
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

test('listSeedObjects: seed/ 아래 파일만 뽑고 폴더(id=null)는 걷어낸다', async () => {
  const supabase = makeFakeSupabase({
    'seed/doc_0.pdf': Buffer.from('a'),
    'seed/doc_1.pdf': Buffer.from('bb'),
  })
  const objs = await listSeedObjects(supabase)
  assert.deepEqual(objs.map(o => o.filePath).sort(), ['seed/doc_0.pdf', 'seed/doc_1.pdf'])
})

test('listSeedObjects: 1000건에 도달하면 페이지네이션 미구현으로 던진다', async () => {
  const objectsByPath = {}
  for (let i = 0; i < 1000; i++) objectsByPath[`seed/doc_${i}.pdf`] = Buffer.from('x')
  const supabase = makeFakeSupabase(objectsByPath)
  await assert.rejects(() => listSeedObjects(supabase), /1000건에 도달/)
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

// ------------------------------------------------------------------ 쓰기

test('writeTarget: 정상 경로면 private 옵션으로 putFn을 부른다', async () => {
  const { putFn, putCalls, store } = makeFakeBlobStore()
  const bytes = Buffer.from('doc')
  await writeTarget('board-documents/seed/doc_0.pdf', bytes, 'application/pdf', {
    blobToken: 't',
    putFn,
  })
  assert.equal(putCalls.length, 1)
  assert.equal(putCalls[0].pathname, 'board-documents/seed/doc_0.pdf')
  assert.deepEqual(store.get('board-documents/seed/doc_0.pdf'), bytes)
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
  // 쓰기 전에.
  const supabase = makeFakeSupabase({
    'seed/../../backups/20260813.sql.gz': Buffer.from('would-be-a-db-dump'),
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
        async list() {
          return { data: [{ id: 'x', name: 'doc_0.pdf', metadata: { size: 999999 } }], error: null }
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
