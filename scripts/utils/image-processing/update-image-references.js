const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const PUBLIC_DIR = path.join(ROOT, 'public')
const TARGET_DIRS = ['data', 'src', 'docs', 'scripts']
const TARGET_EXTENSIONS = new Set(['.json', '.ts', '.tsx', '.js', '.jsx', '.md', '.mdx', '.sql'])
const PATTERN = /(https?:\/\/[^\s"'`]+|\/images\/[\w\-./]+?)\.(jpg|jpeg|png)/gi

const isCheckMode = process.argv.includes('--check')

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
    const ext = path.extname(entry.name)
    if (TARGET_EXTENSIONS.has(ext)) {
      files.push(entryPath)
    }
  }
  return files
}

async function updateFile(filePath) {
  const original = await fs.promises.readFile(filePath, 'utf8')
  let modified = original
  const replacements = new Set()

  modified = modified.replace(PATTERN, (match, base, ext) => {
    const localPath = getLocalRelativePath(base)
    if (!localPath) return match

    const webpFullPath = path.join(PUBLIC_DIR, localPath + '.webp')
    if (!fs.existsSync(webpFullPath)) {
      return match
    }

    const newValue = `${base}.webp`
    if (newValue === `${base}.${ext}`) return match
    replacements.add(`${match} -> ${newValue}`)
    return newValue
  })

  if (replacements.size === 0) return false

  if (isCheckMode) {
    console.error(
      `❌ ${path.relative(ROOT, filePath)} 파일에 WebP로 치환되지 않은 경로가 있습니다:`
    )
    replacements.forEach(r => console.error(`   ${r}`))
    return true
  }

  await fs.promises.writeFile(filePath, modified, 'utf8')
  console.log(`✏️  업데이트: ${path.relative(ROOT, filePath)} (${replacements.size}건)`)
  return true
}

async function main() {
  let hasIssues = false
  for (const dir of TARGET_DIRS) {
    const absoluteDir = path.join(ROOT, dir)
    if (!fs.existsSync(absoluteDir)) continue
    const files = await collectFiles(absoluteDir)
    for (const file of files) {
      const result = await updateFile(file)
      if (isCheckMode && result) {
        hasIssues = true
      }
    }
  }

  if (isCheckMode && hasIssues) {
    process.exitCode = 1
    return
  }

  if (!isCheckMode) {
    console.log('✅ 이미지 경로 업데이트 완료')
  }
}

main().catch(error => {
  console.error('❌ 이미지 경로 업데이트 중 오류가 발생했습니다.', error)
  process.exit(1)
})
