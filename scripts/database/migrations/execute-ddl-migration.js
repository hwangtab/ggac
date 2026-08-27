// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase에 DDL을 RPC로 실행하려 한다.
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
// 스키마 정본은 `src/db/schema/`이고 마이그레이션은 drizzle-kit이 관리한다
// (`npm run db:generate` → `src/db/migrations/`, 적용은 `scripts/turso/README.md`
// 절차). Supabase 마이그레이션은 컷오버로 끝났다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase 스키마를 확인·변경합니다. 스키마 정본은 src/db/schema/ 이고 ' +
    '마이그레이션은 drizzle-kit이 관리합니다(scripts/turso/README.md).'
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

async function executeDDLMigration() {
  try {
    console.log('Attempting to execute DDL migration...')

    // First, let's create a simple test to verify we can create functions
    console.log('Testing function creation capabilities...')

    const { data, error } = await supabase.rpc('handle_new_user')

    if (error && error.code === 'PGRST202') {
      console.log('Cannot create custom RPC functions with current permissions.')
      console.log('')
      console.log('MANUAL STEPS REQUIRED:')
      console.log('===================')
      console.log('')
      console.log(
        '1. Open your Supabase Dashboard: https://supabase.com/dashboard/project/btugywkltavbogdnhwpu'
      )
      console.log('2. Go to the SQL Editor')
      console.log('3. Run the following SQL to add the missing is_member column:')
      console.log('')
      console.log('-- Add is_member column to member_profiles table')
      console.log(
        'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;'
      )
      console.log('')
      console.log(
        '-- Update existing records to set is_member = true for users with complete profile information'
      )
      console.log(
        'UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;'
      )
      console.log('')
      console.log('-- Create index on is_member column for better query performance')
      console.log(
        'CREATE INDEX IF NOT EXISTS idx_member_profiles_is_member ON public.member_profiles(is_member);'
      )
      console.log('')
      console.log('-- Add comment to document the column purpose')
      console.log(
        "COMMENT ON COLUMN public.member_profiles.is_member IS 'Indicates if the user is an active member of the cooperative';"
      )
      console.log('')
      console.log('4. After running the SQL, run this script again to verify the changes:')
      console.log('   node add-is-member-column.js')
      console.log('')

      return
    }

    console.log('Function test result:', data, error)
  } catch (error) {
    console.error('Unexpected error:', error)
  }
}

// Run the function
executeDDLMigration()
