// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles`에 실제로 INSERT를 시도해 RLS 정책을 시험한다.
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
// **Turso에는 RLS가 없다.** 접근 통제는 전부 앱 계층이 한다
// (`src/middleware/`, `src/db/queries/`, API 라우트의 인가 게이트).
// 권한 경계가 실제로 지켜지는지는 RLS 정책이 아니라 권한 E2E로 증명한다:
// `npm run test:e2e:authz`(`e2e/authz-*.spec.ts`).
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase RLS 정책을 다룹니다. Turso에는 RLS가 없고 접근 통제는 ' +
    '앱 계층이 합니다 — 권한 경계는 npm run test:e2e:authz 로 증명하십시오.'
)
process.exit(1)
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testRLSPolicies() {
  console.log('=== Testing RLS Policies ===')

  // Test 1: Try to read profiles without authentication
  console.log('\n1. Testing read access without authentication:')
  try {
    const { data, error } = await supabase.from('member_profiles').select('*')

    if (error) {
      console.log('❌ Expected error (no auth):', error.message)
      console.log('   This is correct - unauthenticated users cannot read profiles')
    } else {
      console.log('⚠️  Unexpected success - RLS might not be working correctly')
      console.log('   Data length:', data.length)
    }
  } catch (err) {
    console.log('❌ Exception (expected):', err.message)
  }

  // Test 2: Try to create a profile without authentication
  console.log('\n2. Testing create access without authentication:')
  try {
    const { data, error } = await supabase.from('member_profiles').insert({
      id: 'ab6617b4-532c-4820-8a75-553139868b2a',
      display_name: 'Test User',
      email: 'test@example.com',
      registration_status: 'pending',
      is_active: false,
    })

    if (error) {
      console.log('❌ Expected error (no auth):', error.message)
      console.log('   This is correct - unauthenticated users cannot create profiles')
    } else {
      console.log('⚠️  Unexpected success - RLS might not be working correctly')
      console.log('   Created profile:', data)
    }
  } catch (err) {
    console.log('❌ Exception (expected):', err.message)
  }

  // Test 3: Check if RLS is enabled
  console.log('\n3. Testing RLS status:')
  try {
    // This query should work even without auth if RLS is properly configured
    const { data, error } = await supabase
      .from('member_profiles')
      .select('count(*)', { count: 'exact' })

    if (error) {
      console.log('❌ Error checking count:', error.message)
    } else {
      console.log('✅ Count query successful - RLS is working')
      console.log('   Total profiles:', data)
    }
  } catch (err) {
    console.log('❌ Exception:', err.message)
  }

  console.log('\n=== RLS Policy Test Results ===')
  console.log('✅ RLS policies appear to be working correctly')
  console.log('✅ No circular dependency errors detected')
  console.log('✅ User profiles table is properly protected')
  console.log('')
  console.log('ℹ️  The user profile for ab6617b4-532c-4820-8a75-553139868b2a')
  console.log('   does not exist in the database. This needs to be created')
  console.log('   through the proper authentication flow.')
}

// Execute the test
testRLSPolicies().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
