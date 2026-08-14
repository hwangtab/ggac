import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { put, list } from '@vercel/blob'

// src/lib/storage/boardDocuments.ts의 BOARD_DOCUMENT_PREFIX와 같은 값이다.
// 이 스크립트는 .mjs라 .ts를 import할 수 없어 문자열을 중복한다. 한쪽을 바꾸면
// 다른 쪽도 바꿔야 한다.
const PREFIX = 'board-documents'
const BUCKET = 'board-documents'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 버킷 전체를 재귀 없이 한 단계만 훑는다 — 이 버킷의 구조는 `<owner>/<file>`이다. */
export async function listBucketObjects(supabase) {
  const objects = []
  const { data: entries, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 })
  if (error) throw new Error(`버킷 목록 조회 실패: ${error.message}`)
  if ((entries ?? []).length >= 1000) {
    throw new Error('루트 항목이 1000개에 도달했다. 페이지네이션이 필요하다.')
  }

  for (const entry of entries ?? []) {
    if (entry.id) {
      // 루트에 바로 놓인 파일. 이 버킷 구조상 나오면 안 된다.
      throw new Error(`예상하지 못한 루트 파일: ${entry.name}`)
    }
    const { data: files, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(entry.name, { limit: 1000 })
    if (listErr) throw new Error(`${entry.name} 목록 조회 실패: ${listErr.message}`)
    if ((files ?? []).length >= 1000) {
      throw new Error(`${entry.name} 항목이 1000개에 도달했다. 페이지네이션이 필요하다.`)
    }
    for (const file of files ?? []) {
      objects.push({
        filePath: `${entry.name}/${file.name}`,
        size: file.metadata?.size ?? 0,
        contentType: file.metadata?.mimetype || 'application/octet-stream',
      })
    }
  }
  return objects
}

async function downloadOne(supabase, filePath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(filePath)
  if (error || !data) throw new Error(`다운로드 실패 ${filePath}: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}

export async function copyAll({ dryRun = false } = {}) {
  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  )
  const token = requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN')

  const objects = await listBucketObjects(supabase)
  console.log(`Supabase 객체 ${objects.length}개`)

  const { blobs } = await list({ token, prefix: `${PREFIX}/`, limit: 1000 })
  const existing = new Set(blobs.map(b => b.pathname))
  console.log(`Blob에 이미 있는 것 ${existing.size}개`)

  let copied = 0
  let skipped = 0
  for (const object of objects) {
    const target = `${PREFIX}/${object.filePath}`
    if (existing.has(target)) {
      skipped++
      continue
    }
    if (dryRun) {
      console.log(`  [dry-run] 복사 예정 ${target} (${object.size}B)`)
      copied++
      continue
    }
    const buffer = await downloadOne(supabase, object.filePath)
    await put(target, buffer, {
      access: 'private',
      contentType: object.contentType,
      token,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    console.log(`  복사 ${target} (${buffer.length}B)`)
    copied++
  }

  console.log(`복사 ${copied}건, 건너뜀 ${skipped}건`)
  return { copied, skipped, total: objects.length }
}

/**
 * 전수 검증. 크기 비교로 끝내지 않고 양쪽 바이트를 모두 받아 SHA-256을 비교한다.
 * 14개 6.21MB라 전수로 해도 부담이 없고, 크기만 같고 내용이 다른 경우를
 * 놓치면 조합 등기부등본이 조용히 손상된 채 남는다.
 */
export async function verifyAll() {
  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  )
  const token = requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN')

  const objects = await listBucketObjects(supabase)
  const { blobs } = await list({ token, prefix: `${PREFIX}/`, limit: 1000 })
  const byPath = new Map(blobs.map(b => [b.pathname, b]))

  let mismatch = 0
  for (const object of objects) {
    const target = `${PREFIX}/${object.filePath}`
    const blob = byPath.get(target)
    if (!blob) {
      console.error(`  없음 ${target}`)
      mismatch++
      continue
    }

    const sourceBuffer = await downloadOne(supabase, object.filePath)
    const response = await fetch(blob.downloadUrl ?? blob.url)
    if (!response.ok) {
      console.error(`  Blob 읽기 실패 ${target}: HTTP ${response.status}`)
      mismatch++
      continue
    }
    const targetBuffer = Buffer.from(await response.arrayBuffer())

    const sourceHash = sha256(sourceBuffer)
    const targetHash = sha256(targetBuffer)
    if (sourceHash !== targetHash) {
      console.error(`  해시 불일치 ${target}: ${sourceHash} vs ${targetHash}`)
      mismatch++
    }
  }

  console.log(`검증 ${objects.length}개, 불일치 ${mismatch}개`)
  return { total: objects.length, mismatch }
}

const isMain = process.argv[1] && process.argv[1].endsWith('copy-board-documents.mjs')
if (isMain) {
  const mode = process.argv[2]
  const run = mode === '--verify' ? verifyAll() : copyAll({ dryRun: mode === '--dry-run' })
  run
    .then(result => {
      if ('mismatch' in result && result.mismatch > 0) process.exitCode = 1
    })
    .catch(error => {
      console.error(error)
      process.exitCode = 1
    })
}
