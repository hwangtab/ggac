import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const appFiles = globSync('src/app/**/{route,page,layout}.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
})

const edgeRuntimeFiles = appFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(source)
})

const middlewareFiles = globSync('src/middleware{.ts,/**/*.ts}', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
})
const middlewareSupabaseImports = middlewareFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /from\s+['"]@supabase\//.test(source)
})

const rateLimiterPath = join(root, 'src/utils/distributedRateLimiter.ts')
const rateLimiterSource = readFileSync(rateLimiterPath, 'utf8')
const constructorMatch = rateLimiterSource.match(
  /constructor\s*\(\)\s*\{[\s\S]*?\n\s{2}\}\n\n\s{2}private reportMemoryFallbackIfNeeded/
)
const constructorSource = constructorMatch?.[0] ?? ''
const logsAtConstruction =
  /log\.(?:error|warn)\(/.test(constructorSource) || /logSecurityEvent\s*\(/.test(constructorSource)

const failures = []

if (edgeRuntimeFiles.length > 0) {
  failures.push(
    `Edge runtime declarations remain:\n${edgeRuntimeFiles.map(file => `- ${file}`).join('\n')}`
  )
}

if (logsAtConstruction) {
  failures.push(
    `distributedRateLimiter logs fallback risk during module construction: ${relative(
      root,
      rateLimiterPath
    )}`
  )
}

if (middlewareSupabaseImports.length > 0) {
  failures.push(
    `Middleware imports Supabase packages directly:\n${middlewareSupabaseImports
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}

console.log('Runtime risk checks passed')
