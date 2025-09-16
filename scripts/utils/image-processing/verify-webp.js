const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const PUBLIC_IMAGES_DIR = path.join(ROOT, 'public', 'images')
const TARGET_DIRS = ['data', 'src', 'docs', 'scripts']
const TARGET_EXTENSIONS = new Set(['.json', '.ts', '.tsx', '.js', '.jsx', '.md', '.mdx', '.sql'])
const PATTERN = /(https?:\/\/[^\s"'`]+|\/images\/[\w\-./]+?)\.(jpg|jpeg|png)/gi
const SOURCE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif'])

function getLocalRelativePath(base) {
  try {
    const url = new URL(base)
    if (!url.hostname.endsWith('ggac.kr')) return null
    return url.pathname.replace(/^\//, '')
  } catch {
    const trimmed = base.replace(/^\//, '')
    if (trimmed.startsWith('images/')) return trimmed
    return null
  }
}

async function collectFiles(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)))
      continue
    }
    if (TARGET_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }
  return files
}

async function verifyReferences() {
  const offenders = []
  for (const dir of TARGET_DIRS) {
    const absoluteDir = path.join(ROOT, dir)
    if (!fs.existsSync(absoluteDir)) continue
    const files = await collectFiles(absoluteDir)
    for (const file of files) {
      const contents = await fs.promises.readFile(file, 'utf8')
      let match
      while ((match = PATTERN.exec(contents)) !== null) {
        const base = match[1]
        const localPath = getLocalRelativePath(base)
        if (!localPath) continue
        const webpPath = path.join(ROOT, 'public', localPath + '.webp')
        if (fs.existsSync(webpPath)) {
          offenders.push({
            file: path.relative(ROOT, file),
            reference: match[0],
          })
        }
      }
    }
  }
  return offenders
}

async function verifyImages() {
  if (!fs.existsSync(PUBLIC_IMAGES_DIR)) return []
  const offenders = []

  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!SOURCE_EXTENSIONS.has(ext)) continue
      const relative = path.relative(path.join(ROOT, 'public'), entryPath)
      const counterpart = relative.replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '.webp')
      if (!fs.existsSync(path.join(ROOT, 'public', counterpart))) {
        offenders.push({
          file: relative,
        })
      }
    }
  }

  await walk(PUBLIC_IMAGES_DIR)
  return offenders
}

async function main() {
  const referenceIssues = await verifyReferences()
  const imageIssues = await verifyImages()

  if (referenceIssues.length === 0 && imageIssues.length === 0) {
    console.log('✅ WebP 검증 통과: 모든 이미지 경로와 파일이 일관됩니다.')
    return
  }

  if (referenceIssues.length > 0) {
    console.error('❌ WebP 경로로 치환되지 않은 참조가 있습니다:')
    referenceIssues.forEach(issue => {
      console.error(`  - ${issue.file}: ${issue.reference}`)
    })
  }

  if (imageIssues.length > 0) {
    console.error('❌ WebP 파일이 존재하지 않는 원본 이미지가 있습니다:')
    imageIssues.forEach(issue => {
      console.error(`  - ${issue.file}`)
    })
  }

  process.exit(1)
}

main().catch(error => {
  console.error('❌ WebP 검증 중 오류가 발생했습니다.', error)
  process.exit(1)
})
