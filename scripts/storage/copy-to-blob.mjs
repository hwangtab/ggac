import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { list, put } from '@vercel/blob'

const PUBLIC_BUCKETS = ['attachments', 'artists']

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

export function planCopy(sourceObjects, existingByPath) {
  const toCopy = []
  const toSkip = []
  for (const obj of sourceObjects) {
    const existing = existingByPath.get(obj.path)
    if (existing !== undefined && existing === obj.size) toSkip.push(obj.path)
    else toCopy.push(obj.path)
  }
  return { toCopy, toSkip }
}

export async function listBucketObjects(supabase, bucket) {
  const out = []
  const walk = async prefix => {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error) throw new Error(`list ${bucket}/${prefix} 실패: ${error.message}`)
    if ((data ?? []).length === 1000) {
      throw new Error(`${bucket}/${prefix}가 1000건에 도달했다. 페이지네이션을 구현해야 한다.`)
    }
    for (const entry of data ?? []) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) await walk(key)
      else out.push({ path: `${bucket}/${key}`, key, size: entry.metadata?.size ?? 0 })
    }
  }
  await walk('')
  return out
}

async function existingBlobSizes(token) {
  const map = new Map()
  let cursor
  do {
    const page = await list({ token, cursor, limit: 1000 })
    for (const b of page.blobs) map.set(b.pathname, b.size)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return map
}

export async function copyBucket(supabase, bucket, { dryRun = false, token } = {}) {
  const objects = await listBucketObjects(supabase, bucket)
  const existing = await existingBlobSizes(token)
  const { toCopy, toSkip } = planCopy(objects, existing)
  const byPath = new Map(objects.map(o => [o.path, o]))
  const failed = []
  const hashes = new Map()

  for (const path of toCopy) {
    const obj = byPath.get(path)
    if (dryRun) continue
    const { data, error } = await supabase.storage.from(bucket).download(obj.key)
    if (error || !data) {
      failed.push(`${path}: download ${error?.message ?? 'no data'}`)
      continue
    }
    const buffer = Buffer.from(await data.arrayBuffer())
    hashes.set(path, sha256(buffer))
    try {
      await put(path, buffer, {
        access: 'public',
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: data.type || 'application/octet-stream',
      })
    } catch (e) {
      failed.push(`${path}: put ${e.message}`)
      hashes.delete(path)
    }
  }

  return {
    target: toCopy.length,
    copied: dryRun ? 0 : toCopy.length - failed.length,
    skipped: toSkip.length,
    failed,
    hashes,
  }
}

/** 원본과 Blob의 해시를 전수 대조한다. 표본이 아니라 전부. */
export async function verifyAll(supabase, buckets, token) {
  const mismatches = []
  let checked = 0
  for (const bucket of buckets) {
    for (const obj of await listBucketObjects(supabase, bucket)) {
      const { data, error } = await supabase.storage.from(bucket).download(obj.key)
      if (error || !data) {
        mismatches.push(`${obj.path}: 원본 다운로드 실패`)
        continue
      }
      const srcHash = sha256(Buffer.from(await data.arrayBuffer()))

      const { blobs } = await list({ token, prefix: obj.path, limit: 1 })
      const match = blobs.find(b => b.pathname === obj.path)
      if (!match) {
        mismatches.push(`${obj.path}: Blob에 없음`)
        continue
      }
      const dstHash = sha256(Buffer.from(await (await fetch(match.url)).arrayBuffer()))
      checked++
      if (srcHash !== dstHash) mismatches.push(`${obj.path}: 해시 불일치`)
    }
  }
  return { checked, mismatches }
}

if (process.argv[1]?.endsWith('copy-to-blob.mjs')) {
  const dryRun = process.argv.includes('--dry-run')
  const verifyOnly = process.argv.includes('--verify')
  const token = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('PUBLIC_BLOB_READ_WRITE_TOKEN이 필요하다')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )

  if (verifyOnly) {
    const r = await verifyAll(supabase, PUBLIC_BUCKETS, token)
    console.log(`전수 검증: ${r.checked}개 대조, 불일치 ${r.mismatches.length}건`)
    for (const m of r.mismatches) console.error('  ', m)
    process.exitCode = r.mismatches.length ? 1 : 0
  } else {
    for (const bucket of PUBLIC_BUCKETS) {
      const r = await copyBucket(supabase, bucket, { dryRun, token })
      console.log(
        `${bucket}: 대상 ${r.target}, 복사 ${r.copied}, 건너뜀 ${r.skipped}, 실패 ${r.failed.length}`
      )
      for (const f of r.failed) console.error('  실패:', f)
    }
  }
}
