// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles`에 `is_member` 컬럼을 추가하려 한다.
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
// Turso `member_profiles`에는 `is_member`가 이미 있다
// (`src/db/schema/identity.ts`). 컬럼 추가는 drizzle-kit 마이그레이션으로 한다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase 스키마/스토리지를 설정합니다. 데이터는 Turso, 객체는 ' +
    'Vercel Blob입니다 — 실행해도 운영에는 아무 영향이 없습니다.'
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

async function addIsMemberColumn() {
  try {
    console.log('Checking current table structure...')

    // First, let's try to read from the table to see what columns exist
    const { data: sampleData, error: sampleError } = await supabase
      .from('member_profiles')
      .select('*')
      .limit(1)

    if (sampleError) {
      console.error('Error reading from member_profiles table:', sampleError)
      return
    }

    console.log('Current table structure (showing one row to see columns):')
    if (sampleData && sampleData.length > 0) {
      console.log('Columns found:', Object.keys(sampleData[0]))

      // Check if is_member column exists
      const hasMemberColumn = Object.keys(sampleData[0]).includes('is_member')

      if (hasMemberColumn) {
        console.log('✅ is_member column already exists')

        // Show sample data
        console.log('Sample data from member_profiles:')
        const { data: allData, error: allError } = await supabase
          .from('member_profiles')
          .select('id, display_name, is_member, phone_number, real_name, registration_status')
          .limit(5)

        if (allError) {
          console.error('Error fetching sample data:', allError)
          return
        }

        console.table(allData)
      } else {
        console.log('❌ is_member column does not exist')
        console.log('')
        console.log('Please run the following SQL in your Supabase SQL Editor:')
        console.log('')
        console.log(
          'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;'
        )
        console.log('')
        console.log(
          'UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;'
        )
        console.log('')
      }
    } else {
      console.log('No data found in member_profiles table')

      // Try to select is_member specifically to see if column exists
      const { data: testData, error: testError } = await supabase
        .from('member_profiles')
        .select('is_member')
        .limit(1)

      if (testError) {
        if (
          testError.code === 'PGRST116' ||
          testError.message.includes('column "is_member" does not exist')
        ) {
          console.log('❌ is_member column does not exist')
          console.log('')
          console.log('Please run the following SQL in your Supabase SQL Editor:')
          console.log('')
          console.log(
            'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;'
          )
          console.log('')
        } else {
          console.error('Error testing is_member column:', testError)
        }
      } else {
        console.log('✅ is_member column exists (table is empty)')
      }
    }
  } catch (error) {
    console.error('Unexpected error:', error)
  }
}

// Run the function
addIsMemberColumn()
