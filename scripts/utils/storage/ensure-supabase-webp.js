// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// 이 스크립트는 Supabase Storage `profiles` 버킷의 이미지를 WebP/JPEG로
// 변환해 다시 올리고, Supabase `member_profiles`의
// `profile_photo_url`·`profile_photo_metadata`를 UPDATE한다.
// package.json의 `storage:ensure-webp`로 배선돼 있었다(같은 커밋에서 제거).
//
// 컷오버(2026-08-26) 이후 앱은 Supabase를 어디에서도 읽지 않는다. 그런데
// `.env.local`에 Supabase 값이 남아 있으면 이 스크립트는 **버려진 사본을
// 건드리고 성공 메시지를 내고 끝난다** — 화면은 그대로인데 아무도 이유를
// 모른다. 조용한 성공이 이 저장소에서 가장 비싼 실패이므로 아래 가드가
// 무조건 막는다. 지금 이걸 막고 있는 건 `dotenv` 미설치나 따옴표 파싱
// 실패 같은 **우연**이었다 — `npm i dotenv` 한 번이나
// `set -a; source .env.local; set +a`(scripts/turso/README.md가 DB 작업 전에
// 하라고 안내하는 바로 그 명령)면 그 우연은 사라진다.
//
// **Turso `member_profiles`에는 그 두 컬럼이 아예 없다.** 회원 사진은
// `artists.profile_photo_url`·`artists.profile_photo_metadata`에 있다
// (`src/db/schema/identity.ts`). 객체 저장소도 Supabase Storage가 아니라
// Vercel Blob이다(`src/lib/storage/`). 즉 이 스크립트는 존재하지 않는
// 컬럼을, 아무도 읽지 않는 버킷에 대해 갱신하려 든다.
// "회원 사진이 이상하다"를 고치려면 여기가 아니라 업로드 경로
// (`src/lib/storage/`)와 `artists` 표를 봐야 한다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase Storage와 Supabase `member_profiles`를 갱신합니다. ' +
    'Turso `member_profiles`에는 profile_photo_url/profile_photo_metadata 컬럼이 없고 ' +
    '(회원 사진은 artists 표), 객체는 Vercel Blob에 있습니다 — 실행해도 아무것도 안 바뀝니다.'
)
process.exit(1)
const fs = require('fs')
const path = require('path')
const os = require('os')
const sharp = require('sharp')
const { createClient } = require('@supabase/supabase-js')

const SUPPORTED_IMAGE_TYPES = new Set(['.jpg', '.jpeg', '.png'])
const TEMP_DIR_PREFIX = 'supabase-webp-sync-'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error(
      '❌ NEXT_PUBLIC_SUPABASE_URL 혹은 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요합니다.'
    )
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const bucketsToProcess = ['profiles']
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX))
  console.log('🗂️  임시 작업 디렉터리:', tempDir)

  try {
    for (const bucket of bucketsToProcess) {
      console.log(`\n=== Bucket: ${bucket} ===`)
      await processBucket(supabase, bucket)
    }
  } catch (error) {
    console.error('❌ 변환 중 오류가 발생했습니다.', error)
    process.exitCode = 1
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch (cleanupError) {
      console.warn('임시 디렉터리 정리 실패:', cleanupError)
    }
  }
}

async function processBucket(supabase, bucket) {
  let page = 0
  const pageSize = 100
  let processedCount = 0
  let skippedCount = 0

  while (true) {
    const { data: files, error } = await supabase.storage.from(bucket).list('', {
      limit: pageSize,
      offset: page * pageSize,
      sortBy: { column: 'name', order: 'asc' },
    })

    if (error) {
      console.error('❌ 파일 목록 조회 실패:', error)
      break
    }
    if (!files || files.length === 0) {
      break
    }

    for (const file of files) {
      if (!file.name) continue
      if (file.name.endsWith('/')) continue
      if (file.name.endsWith('.webp') || file.name.endsWith('.fallback.jpg')) continue

      const ext = path.extname(file.name).toLowerCase()
      if (!SUPPORTED_IMAGE_TYPES.has(ext)) {
        skippedCount++
        continue
      }

      const filePath = file.name
      console.log(`\n📄 처리 대상: ${filePath}`)

      const webpPath = filePath.replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '.webp')
      const fallbackPath = filePath.replace(
        new RegExp(`${ext.replace('.', '\\.')}$`, 'i'),
        '.fallback.jpg'
      )

      const webpExists = await fileExists(supabase, bucket, webpPath)
      const fallbackExists = await fileExists(supabase, bucket, fallbackPath)

      if (webpExists && fallbackExists) {
        console.log('⏭️  이미 WebP/폴백이 존재하여 건너뜀')
        skippedCount++
        continue
      }

      const { data: downloadData, error: downloadError } = await supabase.storage
        .from(bucket)
        .download(filePath)

      if (downloadError || !downloadData) {
        console.error('❌ 파일 다운로드 실패:', downloadError)
        continue
      }

      const buffer = Buffer.from(await downloadData.arrayBuffer())

      try {
        const result = await generateVariants(supabase, bucket, filePath, buffer)
        if (result) {
          await updateMetadata(supabase, bucket, filePath, result)
          processedCount++
        } else {
          skippedCount++
        }
      } catch (variantError) {
        console.error('❌ 변형 생성 실패:', variantError)
      }
    }

    page++
  }

  console.log(`\n✅ ${bucket} 처리 완료: 변환 ${processedCount}건, 건너뜀 ${skippedCount}건`)
}

async function fileExists(supabase, bucket, filePath) {
  const directory = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(directory === '.' ? '' : directory, {
      search: fileName,
      limit: 1,
    })
  if (error) return false
  return !!(data && data.length > 0)
}

async function generateVariants(supabase, bucket, filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase()
  const basePath = filePath.slice(0, filePath.length - ext.length)

  let webpPath
  if (!filePath.toLowerCase().endsWith('.gif')) {
    const webpBuffer = await sharp(buffer).webp({ quality: 82 }).toBuffer()
    const { error: webpError } = await supabase.storage
      .from(bucket)
      .upload(`${basePath}.webp`, webpBuffer, {
        upsert: true,
        cacheControl: '3600',
        contentType: 'image/webp',
      })
    if (webpError) {
      console.warn('WebP 업로드 실패:', webpError)
    } else {
      webpPath = `${basePath}.webp`
    }
  }

  const isOriginalJpeg = ext === '.jpg' || ext === '.jpeg'
  const jpegBuffer = isOriginalJpeg ? buffer : await sharp(buffer).jpeg({ quality: 85 }).toBuffer()
  const fallbackPath = isOriginalJpeg ? filePath : `${basePath}.fallback.jpg`
  const { error: fallbackError } = await supabase.storage
    .from(bucket)
    .upload(fallbackPath, jpegBuffer, {
      upsert: true,
      cacheControl: '3600',
      contentType: 'image/jpeg',
    })
  if (fallbackError) {
    console.warn('JPEG 폴백 업로드 실패:', fallbackError)
  }

  if (!webpPath && isOriginalJpeg) {
    webpPath = undefined
  }

  if (!webpPath && fallbackError) {
    return null
  }

  return {
    webp: webpPath,
    fallback: fallbackPath,
    variant_metadata: {
      webp: webpPath ? { size: undefined, content_type: 'image/webp' } : undefined,
      fallback: { size: jpegBuffer.length, content_type: 'image/jpeg' },
    },
  }
}

async function updateMetadata(supabase, bucket, originalPath, variants) {
  const pathParts = originalPath.split('/')
  if (pathParts.length < 2) return
  const userId = pathParts[1]

  const { data: profile, error } = await supabase
    .from('member_profiles')
    .select('profile_photo_url, profile_photo_metadata')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    console.warn('메타데이터 갱신을 위한 프로필 정보를 찾을 수 없습니다:', error)
    return
  }

  const originalUrl = supabase.storage.from(bucket).getPublicUrl(originalPath).data?.publicUrl
  const webpUrl = variants.webp
    ? supabase.storage.from(bucket).getPublicUrl(variants.webp).data?.publicUrl
    : undefined
  const fallbackUrl = variants.fallback
    ? supabase.storage.from(bucket).getPublicUrl(variants.fallback).data?.publicUrl
    : undefined

  const updatedMetadata = {
    ...(profile.profile_photo_metadata || {}),
    variants: {
      ...(profile.profile_photo_metadata?.variants || {}),
      original: originalPath,
      webp: variants.webp || profile.profile_photo_metadata?.variants?.webp,
      fallback: variants.fallback || profile.profile_photo_metadata?.variants?.fallback,
    },
    variant_urls: {
      ...(profile.profile_photo_metadata?.variant_urls || {}),
      original: originalUrl || profile.profile_photo_metadata?.variant_urls?.original,
      webp: webpUrl || profile.profile_photo_metadata?.variant_urls?.webp,
      fallback: fallbackUrl || profile.profile_photo_metadata?.variant_urls?.fallback,
    },
    variant_metadata: {
      ...(profile.profile_photo_metadata?.variant_metadata || {}),
      ...(variants.variant_metadata || {}),
    },
  }

  await supabase
    .from('member_profiles')
    .update({
      profile_photo_url: variants.webp || originalPath,
      profile_photo_metadata: updatedMetadata,
    })
    .eq('id', userId)
}

main().catch(error => {
  console.error('예상치 못한 오류가 발생했습니다.', error)
  process.exit(1)
})
