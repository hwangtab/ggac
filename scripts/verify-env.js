#!/usr/bin/env node

/**
 * Environment Variable Verification Script
 * Checks if all required environment variables are present and valid
 */

const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

const optionalEnvVars = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'NEXT_STRICT_CSP',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
]

console.log('🔍 Environment Variable Verification\n')

let hasErrors = false

// Check required variables
console.log('📋 Required Environment Variables:')
requiredEnvVars.forEach(varName => {
  const value = process.env[varName]
  if (!value) {
    console.log(`❌ ${varName}: Missing`)
    hasErrors = true
  } else {
    // Mask sensitive values for display
    const displayValue =
      varName.includes('KEY') || varName.includes('TOKEN')
        ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
        : value
    console.log(`✅ ${varName}: ${displayValue}`)
  }
})

console.log('\n📋 Optional Environment Variables:')
optionalEnvVars.forEach(varName => {
  const value = process.env[varName]
  if (!value) {
    console.log(`⚠️  ${varName}: Not set (optional)`)
  } else {
    const displayValue =
      varName.includes('KEY') || varName.includes('TOKEN')
        ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
        : value
    console.log(`✅ ${varName}: ${displayValue}`)
  }
})

// Validate Supabase URL format
if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
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
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    console.log('⚠️  Redis not configured - rate limiting will use memory fallback')
  }

  // Check CSP setting
  if (process.env.NEXT_STRICT_CSP === 'true') {
    console.log('🔒 Strict CSP enabled')
  } else {
    console.log('⚠️  Strict CSP not enabled')
  }
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
