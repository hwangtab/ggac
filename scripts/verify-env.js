#!/usr/bin/env node

/**
 * Environment Variable Verification Script
 * Checks if all required environment variables are present and valid
 */

const { loadEnvConfig } = require('@next/env')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const sourceArg = process.argv.find(arg => arg.startsWith('--source='))
const envSource = sourceArg ? sourceArg.split('=')[1] : 'local'
const validSources = new Set(['local', 'vercel'])

if (!validSources.has(envSource)) {
  console.error(`Unsupported env source: ${envSource}`)
  console.error('Use --source=local or --source=vercel')
  process.exit(1)
}

loadEnvConfig(process.cwd())

const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

const redisEnvGroups = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
]
const productionRequiredValues = {
  NEXT_STRICT_CSP: 'true',
}

const optionalEnvVars = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'NEXT_STRICT_CSP',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
]

console.log('🔍 Environment Variable Verification\n')
console.log(
  `📦 Source: ${envSource === 'vercel' ? 'Vercel Production' : 'Local environment files'}`
)

function parseEnvFile(filePath) {
  const env = {}
  const content = fs.readFileSync(filePath, 'utf8')

  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) return

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    env[key] = value
  })

  return env
}

function loadVercelProductionEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggac-vercel-env-'))
  const tempFile = path.join(tempDir, '.env.production.local')

  try {
    execFileSync('vercel', ['env', 'pull', tempFile, '--environment=production', '--yes'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const env = parseEnvFile(tempFile)
    mergeVercelHiddenEnvPresence(env)

    return env
  } catch (error) {
    console.error('❌ Failed to pull Vercel production environment variables.')
    const stderr = error && error.stderr ? String(error.stderr).trim() : ''
    if (stderr) console.error(stderr)
    process.exit(1)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const VERCEL_HIDDEN_VALUE_PRESENT = '__VERCEL_HIDDEN_ENV_VALUE_PRESENT__'

function parseVercelJsonOutput(output) {
  const jsonStart = output.indexOf('{')
  const jsonEnd = output.lastIndexOf('}')

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error('Vercel CLI did not return JSON output')
  }

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1))
}

function mergeVercelHiddenEnvPresence(env) {
  let parsed

  try {
    const output = execFileSync('vercel', ['env', 'ls', 'production', '--format=json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    parsed = parseVercelJsonOutput(output)
  } catch {
    return
  }

  if (!Array.isArray(parsed.envs)) return

  parsed.envs.forEach(item => {
    const key = item && typeof item.key === 'string' ? item.key : null
    const type = item && typeof item.type === 'string' ? item.type : null
    const targets = Array.isArray(item && item.target) ? item.target : []

    if (!key || !targets.includes('production')) return
    if (env[key]) return

    if (type === 'sensitive' || type === 'encrypted') {
      env[key] = VERCEL_HIDDEN_VALUE_PRESENT
    }
  })
}

function formatEnvValue(varName, value) {
  if (value === VERCEL_HIDDEN_VALUE_PRESENT) {
    return 'Present (value hidden by Vercel)'
  }

  return varName.includes('KEY') || varName.includes('TOKEN')
    ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
    : value
}

const env = envSource === 'vercel' ? loadVercelProductionEnv() : process.env

let hasErrors = false

function hasCompleteEnvGroup(env, groups) {
  return groups.some(group => group.every(varName => Boolean(env[varName])))
}

function getIncompleteEnvGroups(env, groups) {
  return groups.filter(group => !group.every(varName => Boolean(env[varName])))
}

// Check required variables
console.log('📋 Required Environment Variables:')
requiredEnvVars.forEach(varName => {
  const value = env[varName]
  if (!value) {
    console.log(`❌ ${varName}: Missing`)
    hasErrors = true
  } else {
    // Mask sensitive values for display
    const displayValue = formatEnvValue(varName, value)
    console.log(`✅ ${varName}: ${displayValue}`)
  }
})

console.log('\n📋 Optional Environment Variables:')
optionalEnvVars.forEach(varName => {
  const value = env[varName]
  if (!value) {
    console.log(`⚠️  ${varName}: Not set (optional)`)
  } else {
    const displayValue = formatEnvValue(varName, value)
    console.log(`✅ ${varName}: ${displayValue}`)
  }
})

// Validate Supabase URL format
if (env.NEXT_PUBLIC_SUPABASE_URL) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
    console.log(
      `❌ NEXT_PUBLIC_SUPABASE_URL: Invalid format (should be https://[project].supabase.co)`
    )
    hasErrors = true
  }
}

// Check environment
console.log(`\n🌍 Environment: ${process.env.NODE_ENV || 'development'}`)
console.log(`🔧 Platform: ${process.platform}`)

// Additional checks for production
if (process.env.NODE_ENV === 'production') {
  console.log('\n🏭 Production Environment Checks:')

  // Check if Redis is configured for production rate limiting
  const hasRedisEnv = hasCompleteEnvGroup(env, redisEnvGroups)
  if (!hasRedisEnv) {
    getIncompleteEnvGroups(env, redisEnvGroups).forEach(group => {
      console.log(`❌ ${group.join(' + ')}: Missing complete Redis env group in production`)
    })
    console.log(
      '❌ Redis not configured - production rate-limited APIs will fail closed. Set either UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN.'
    )
    hasErrors = true
  } else {
    console.log('✅ Redis REST env group configured for production rate limiting')
  }

  Object.entries(productionRequiredValues).forEach(([varName, expectedValue]) => {
    if (env[varName] !== expectedValue) {
      console.log(`❌ ${varName}: Expected "${expectedValue}" in production`)
      hasErrors = true
    } else {
      console.log(`✅ ${varName}: "${expectedValue}"`)
    }
  })
}

console.log('\n' + '='.repeat(50))

if (hasErrors) {
  console.log('❌ Environment verification failed!')
  console.log('Please set the missing required environment variables.')
  process.exit(1)
} else {
  console.log('✅ Environment verification passed!')
  console.log('All required environment variables are properly configured.')
}
