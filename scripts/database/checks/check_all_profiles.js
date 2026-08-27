// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles` 전체와 GoTrue admin API(`auth.admin`)의 계정
// 목록을 조회해 대조한다.
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
// 지금 무엇이 들어 있는지 보려면 Turso를 봐라: `turso db shell ggac-prod`,
// 또는 쿼리 계층 `src/db/queries/`(profiles.ts·posts.ts·activities.ts …).
// 스키마 자체는 `src/db/schema/`가 정본이고, `npm run test:schema-contract`가
// 코드-스키마 계약을 정적으로 대조한다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase를 조회해 상태를 보고합니다. 데이터의 권위는 Turso이므로 ' +
    '버려진 사본을 "정상"이라고 보고하게 됩니다 — turso db shell ggac-prod 또는 ' +
    'src/db/queries/ 를 보십시오.'
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

async function checkAllProfiles() {
  console.log('=== Checking all profiles ===')

  try {
    // Try to fetch all profiles
    const { data, error } = await supabase.from('member_profiles').select('*')

    if (error) {
      console.error('❌ Error fetching profiles:', error)
    } else {
      console.log('✅ Total profiles found:', data.length)

      if (data.length > 0) {
        console.log('\n📊 Profile details:')
        data.forEach((profile, index) => {
          console.log(`  ${index + 1}. ${profile.display_name} (${profile.email})`)
          console.log(`     ID: ${profile.id}`)
          console.log(`     Status: ${profile.registration_status}`)
          console.log(`     Active: ${profile.is_active}`)
          console.log(`     Admin: ${profile.is_admin}`)
          console.log(`     Created: ${profile.created_at}`)
          console.log('     ---')
        })
      } else {
        console.log('⚠️  No profiles found in the database')
      }
    }
  } catch (err) {
    console.error('❌ Exception checking profiles:', err)
  }

  // Also check auth users if possible
  console.log('\n=== Checking auth users ===')
  try {
    // This might not work with anon key, but let's try
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers()

    if (authError) {
      console.error('❌ Cannot access auth users (expected with anon key):', authError.message)
    } else {
      console.log('✅ Auth users found:', authData.users.length)
    }
  } catch (err) {
    console.error('❌ Cannot access auth users (expected with anon key):', err.message)
  }
}

// Execute the check
checkAllProfiles().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
