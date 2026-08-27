// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase PostgREST(`/rest/v1/`)에 직접 POST해 SQL을 실행하려 한다.
// (node-fetch 의존도 설치돼 있지 않다.)
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
const fetch = require('node-fetch')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

async function executeSQLDirectly() {
  console.log('Attempting to execute SQL directly via REST API...')

  const sql = `
    ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;
    UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_member_profiles_is_member ON public.member_profiles(is_member);
    COMMENT ON COLUMN public.member_profiles.is_member IS 'Indicates if the user is an active member of the cooperative';
  `

  try {
    // Try to execute via direct REST API call
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/execute_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        sql_query: sql,
      }),
    })

    const result = await response.text()

    if (response.ok) {
      console.log('✅ SQL executed successfully:', result)
      return true
    } else {
      console.log('❌ Direct API execution failed:', result)
      console.log('Response status:', response.status)

      // Show the final instructions
      console.log('')
      console.log('FINAL INSTRUCTIONS:')
      console.log('==================')
      console.log('')
      console.log('Since automated execution is not possible with the current permissions,')
      console.log('please manually execute the SQL in the Supabase Dashboard:')
      console.log('')
      console.log('1. Go to: https://supabase.com/dashboard/project/btugywkltavbogdnhwpu/sql/new')
      console.log('2. Paste and run this SQL:')
      console.log('')
      console.log(sql)
      console.log('')
      console.log('3. Verify with: node verify-and-add-is-member-column.js')

      return false
    }
  } catch (error) {
    console.error('❌ Network error:', error.message)
    return false
  }
}

// Execute the function
executeSQLDirectly().then(success => {
  if (success) {
    console.log('🎉 Column added successfully!')
    process.exit(0)
  } else {
    console.log('⚠️  Manual execution required.')
    process.exit(1)
  }
})
