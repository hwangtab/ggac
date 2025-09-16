const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = process.cwd()
const PUBLIC_IMAGES_DIR = path.join(ROOT, 'public', 'images')
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif'])
const WEBP_QUALITY = 85

async function ensureWebp() {
  if (!fs.existsSync(PUBLIC_IMAGES_DIR)) {
    console.error(`❌ public/images 디렉터리를 찾을 수 없습니다: ${PUBLIC_IMAGES_DIR}`)
    process.exit(1)
  }

  const created = []
  const skipped = []
  const errors = []

  async function processEntry(entryPath) {
    const stat = await fs.promises.stat(entryPath)
    if (stat.isDirectory()) {
      const children = await fs.promises.readdir(entryPath)
      await Promise.all(children.map(child => processEntry(path.join(entryPath, child))))
      return
    }

    const ext = path.extname(entryPath).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) return

    const relativeFromPublic = path.relative(path.join(ROOT, 'public'), entryPath)
    const webpPath = path.join(
      ROOT,
      'public',
      relativeFromPublic.replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '.webp')
    )

    if (fs.existsSync(webpPath)) {
      skipped.push(path.relative(PUBLIC_IMAGES_DIR, entryPath))
      return
    }

    try {
      await sharp(entryPath).webp({ quality: WEBP_QUALITY }).toFile(webpPath)
      created.push(path.relative(PUBLIC_IMAGES_DIR, webpPath))
    } catch (error) {
      errors.push({ file: path.relative(PUBLIC_IMAGES_DIR, entryPath), error })
    }
  }

  await processEntry(PUBLIC_IMAGES_DIR)

  if (created.length) {
    console.log(`✅ 새 WebP 생성 (${created.length}개):`)
    created.forEach(file => console.log(`  - ${file}`))
  } else {
    console.log('ℹ️ 새로 생성된 WebP 파일이 없습니다.')
  }

  if (skipped.length) {
    console.log(`⏭️  이미 WebP가 존재하여 건너뜀 (${skipped.length}개)`)
  }

  if (errors.length) {
    console.error('❌ 변환 실패 파일:')
    errors.forEach(({ file, error }) => {
      console.error(`  - ${file}: ${error.message}`)
    })
    process.exitCode = 1
  }
}

ensureWebp().catch(error => {
  console.error('❌ WebP 변환 중 오류가 발생했습니다.', error)
  process.exit(1)
})
