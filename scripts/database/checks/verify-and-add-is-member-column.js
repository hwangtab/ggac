// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles`에 `is_member` 컬럼이 있는지 확인하고 없으면
// 추가할 SQL을 안내한다.
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
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyAndAddIsMemberColumn() {
  console.log('='.repeat(60))
  console.log('SUPABASE MEMBER_PROFILES TABLE VERIFICATION')
  console.log('='.repeat(60))
  console.log('')

  try {
    console.log('1. Checking if is_member column exists...')

    // Test if the column exists by trying to select it
    const { data: testData, error: testError } = await supabase
      .from('member_profiles')
      .select('is_member')
      .limit(1)

    if (testError) {
      if (testError.code === '42703' || testError.message.includes('does not exist')) {
        console.log('❌ is_member column does NOT exist')
        console.log('')
        console.log('REQUIRED ACTION:')
        console.log('---------------')
        console.log('Please manually add the is_member column by following these steps:')
        console.log('')
        console.log(
          '1. Open Supabase Dashboard: https://supabase.com/dashboard/project/btugywkltavbogdnhwpu'
        )
        console.log('2. Navigate to SQL Editor')
        console.log('3. Copy and paste the following SQL:')
        console.log('')
        console.log('-- Add is_member column to member_profiles table')
        console.log(
          'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;'
        )
        console.log('')
        console.log(
          '-- Update existing records (set is_member = true for users with complete info)'
        )
        console.log(
          'UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;'
        )
        console.log('')
        console.log('-- Create index for better performance')
        console.log(
          'CREATE INDEX IF NOT EXISTS idx_member_profiles_is_member ON public.member_profiles(is_member);'
        )
        console.log('')
        console.log('-- Add documentation comment')
        console.log(
          "COMMENT ON COLUMN public.member_profiles.is_member IS 'Indicates if the user is an active member of the cooperative';"
        )
        console.log('')
        console.log('4. Execute the SQL')
        console.log('5. Run this script again to verify: node verify-and-add-is-member-column.js')
        console.log('')

        return false
      } else {
        console.error('❌ Unexpected error testing is_member column:', testError)
        return false
      }
    }

    console.log('✅ is_member column exists!')
    console.log('')

    // Get current table structure
    console.log('2. Checking current table structure...')
    const { data: sampleData, error: sampleError } = await supabase
      .from('member_profiles')
      .select('*')
      .limit(1)

    if (sampleError) {
      console.error('❌ Error fetching sample data:', sampleError)
      return false
    }

    if (sampleData && sampleData.length > 0) {
      console.log('✅ Table columns:', Object.keys(sampleData[0]).join(', '))
    } else {
      console.log('✅ Table exists but is empty')
    }
    console.log('')

    // Check existing data
    console.log('3. Checking existing data...')
    const { data: allData, error: allError } = await supabase
      .from('member_profiles')
      .select(
        'id, display_name, email, is_member, phone_number, real_name, registration_status, is_active'
      )
      .limit(10)

    if (allError) {
      console.error('❌ Error fetching data:', allError)
      return false
    }

    if (allData && allData.length > 0) {
      console.log(`✅ Found ${allData.length} records in member_profiles table:`)
      console.table(allData)

      // Analyze is_member distribution
      const memberCount = allData.filter(row => row.is_member).length
      const nonMemberCount = allData.filter(row => !row.is_member).length

      console.log('')
      console.log('📊 is_member status distribution:')
      console.log(`   - Members (is_member = true): ${memberCount}`)
      console.log(`   - Non-members (is_member = false): ${nonMemberCount}`)
      console.log(`   - Total records: ${allData.length}`)
    } else {
      console.log('✅ Table is empty (no records found)')
    }

    console.log('')
    console.log('4. Verification complete!')
    console.log('✅ The is_member column has been successfully added to the member_profiles table.')
    console.log('')

    return true
  } catch (error) {
    console.error('❌ Unexpected error during verification:', error)
    return false
  }
}

// Run the verification
verifyAndAddIsMemberColumn()
  .then(success => {
    if (success) {
      console.log('🎉 SUCCESS: is_member column is properly configured!')
      process.exit(0)
    } else {
      console.log('⚠️  MANUAL ACTION REQUIRED: Please follow the instructions above.')
      process.exit(1)
    }
  })
  .catch(error => {
    console.error('Script execution failed:', error)
    process.exit(1)
  })
