#!/usr/bin/env node
// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles`를 조회해 거부 회원 수가 0으로 보이는 이유를 조사한다.
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
// 2025년 당시의 일회성 조사다. 같은 질문을 지금 하려면 Turso를 봐야 한다:
// `turso db shell ggac-prod` 또는 `src/db/queries/`.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 2025년 Supabase 시절의 일회성 조사 스크립트입니다. 데이터의 권위는 Turso이므로 ' +
    '실행하면 버려진 사본을 조사하게 됩니다 — turso db shell ggac-prod 를 쓰십시오.'
)
process.exit(1)

/**
 * Database Investigation Script for Rejected Members Issue
 *
 * This script investigates why the "Rejected Count" is showing 0 in admin reports
 * by directly querying the database and analyzing the data.
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load environment variables from .env.local
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env.local')
    const envData = fs.readFileSync(envPath, 'utf8')

    envData.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=')
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim()
        process.env[key.trim()] = value
      }
    })
  } catch (error) {
    console.log('ℹ️  Could not load .env.local file, using system environment variables')
  }
}

async function investigateRejectedMembers() {
  console.log('🔍 Starting investigation of rejected members issue...\n')

  // Load environment variables
  loadEnvFile()

  // Create Supabase client with service role key for full access
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not configured!')
    console.log('Please make sure your .env.local file contains:')
    console.log('SUPABASE_SERVICE_ROLE_KEY=your_service_role_key')
    process.exit(1)
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  try {
    console.log('📊 1. Querying all member profiles...')

    // Query all member profiles
    const { data: allMembers, error: allMembersError } = await supabase
      .from('member_profiles')
      .select('id, display_name, email, registration_status, created_at, is_active')
      .order('created_at', { ascending: false })

    if (allMembersError) {
      console.error('❌ Error querying all members:', allMembersError)
      return
    }

    console.log(`📈 Total members found: ${allMembers?.length || 0}`)

    // Analyze registration statuses
    const statusCounts =
      allMembers?.reduce((acc, member) => {
        acc[member.registration_status] = (acc[member.registration_status] || 0) + 1
        return acc
      }, {}) || {}

    console.log('\n📋 Registration status breakdown:')
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`)
    })

    console.log('\n🔍 2. Looking for rejected members specifically...')

    // Query specifically for rejected members
    const { data: rejectedMembers, error: rejectedError } = await supabase
      .from('member_profiles')
      .select('id, display_name, email, registration_status, created_at')
      .eq('registration_status', 'rejected')
      .order('created_at', { ascending: false })

    if (rejectedError) {
      console.error('❌ Error querying rejected members:', rejectedError)
      return
    }

    console.log(`📊 Rejected members found: ${rejectedMembers?.length || 0}`)

    if (rejectedMembers && rejectedMembers.length > 0) {
      console.log('\n📝 Rejected members details:')
      rejectedMembers.forEach(member => {
        console.log(`  - ID: ${member.id}`)
        console.log(`    Name: ${member.display_name || 'N/A'}`)
        console.log(`    Email: ${member.email}`)
        console.log(`    Created: ${member.created_at}`)
        console.log(`    Status: ${member.registration_status}`)
        console.log('')
      })
    } else {
      console.log('ℹ️  No rejected members found in database')
    }

    console.log('\n📅 3. Testing date range filtering...')

    // Test different date ranges to see if they affect the count
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

    // Set proper time boundaries
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    sixtyDaysAgo.setHours(0, 0, 0, 0)
    now.setHours(23, 59, 59, 999)

    console.log(`📊 Testing date ranges:`)
    console.log(`  - Last 30 days: ${thirtyDaysAgo.toISOString()} to ${now.toISOString()}`)
    console.log(`  - Last 60 days: ${sixtyDaysAgo.toISOString()} to ${now.toISOString()}`)

    // Test 30-day range
    const { data: rejected30Days, error: rejected30Error } = await supabase
      .from('member_profiles')
      .select('id, registration_status, created_at')
      .eq('registration_status', 'rejected')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .lte('created_at', now.toISOString())

    if (!rejected30Error) {
      console.log(`📈 Rejected in last 30 days: ${rejected30Days?.length || 0}`)
    }

    // Test 60-day range
    const { data: rejected60Days, error: rejected60Error } = await supabase
      .from('member_profiles')
      .select('id, registration_status, created_at')
      .eq('registration_status', 'rejected')
      .gte('created_at', sixtyDaysAgo.toISOString())
      .lte('created_at', now.toISOString())

    if (!rejected60Error) {
      console.log(`📈 Rejected in last 60 days: ${rejected60Days?.length || 0}`)
    }

    console.log('\n🔍 4. Simulating the exact report generation query...')

    // Simulate the exact query from the report generation code
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)

    console.log(`📅 Report date range: ${startDate.toISOString()} to ${endDate.toISOString()}`)

    const { data: reportRegistrations, error: reportError } = await supabase
      .from('member_profiles')
      .select('id, display_name, email, registration_status, is_artist, created_at')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())

    if (reportError) {
      console.error('❌ Error in report simulation:', reportError)
      return
    }

    console.log(`📊 Total registrations in report period: ${reportRegistrations?.length || 0}`)

    const reportStatusStats =
      reportRegistrations?.reduce((acc, user) => {
        acc[user.registration_status] = (acc[user.registration_status] || 0) + 1
        return acc
      }, {}) || {}

    console.log('\n📋 Report period status breakdown:')
    Object.entries(reportStatusStats).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`)
    })

    console.log(`\n📈 Rejected count from report logic: ${reportStatusStats.rejected || 0}`)

    console.log('\n🔍 5. Checking for data inconsistencies...')

    // Check if there are any weird registration_status values
    const uniqueStatuses = [...new Set(allMembers?.map(m => m.registration_status) || [])]
    console.log(`📋 All unique registration_status values found:`)
    uniqueStatuses.forEach(status => {
      console.log(`  - "${status}" (type: ${typeof status})`)
    })

    // Check for null or undefined values
    const nullStatuses = allMembers?.filter(m => m.registration_status == null) || []
    console.log(`📊 Members with null/undefined registration_status: ${nullStatuses.length}`)

    console.log('\n✅ Investigation complete!')
  } catch (error) {
    console.error('❌ Investigation failed:', error)
  }
}

// Run the investigation
investigateRejectedMembers()
