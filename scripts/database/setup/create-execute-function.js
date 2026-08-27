// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase에 임의 SQL을 실행하는 `execute_sql` RPC 함수를 만들려 한다.
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
// Turso에는 이런 우회로가 없고 필요하지도 않다 — 스키마 변경은 drizzle-kit,
// 임시 조회는 `turso db shell ggac-prod`다. (임의 SQL을 실행하는 RPC를
// 되살리는 것 자체가 권한 경계상 나쁜 생각이다.)
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

async function createExecuteFunction() {
  try {
    console.log('Creating execute_sql function...')

    // Create a function that can execute raw SQL
    const { data, error } = await supabase.rpc('exec', {
      query: `
        CREATE OR REPLACE FUNCTION public.execute_sql(sql_query TEXT)
        RETURNS TEXT AS $$
        BEGIN
          EXECUTE sql_query;
          RETURN 'Success';
        EXCEPTION WHEN OTHERS THEN
          RETURN 'Error: ' || SQLERRM;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
      `,
    })

    if (error) {
      console.error('Error creating function:', error)

      // Try alternative approach using a different method
      console.log('Trying alternative approach...')

      // Maybe we need to use the admin/service key
      console.log('This requires admin privileges to create functions.')
      console.log('Please run the following SQL in your Supabase SQL Editor:')
      console.log('')
      console.log(`
CREATE OR REPLACE FUNCTION public.execute_sql(sql_query TEXT)
RETURNS TEXT AS $$
BEGIN
  EXECUTE sql_query;
  RETURN 'Success';
EXCEPTION WHEN OTHERS THEN
  RETURN 'Error: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
      `)
      console.log('')
      console.log('Then run the following to add the is_member column:')
      console.log('')
      console.log(
        "SELECT public.execute_sql('ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;');"
      )
      console.log('')

      return
    }

    console.log('Function created successfully')

    // Now use the function to add the column
    const { data: result, error: execError } = await supabase.rpc('execute_sql', {
      sql_query:
        'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;',
    })

    if (execError) {
      console.error('Error executing SQL:', execError)
      return
    }

    console.log('SQL execution result:', result)
  } catch (error) {
    console.error('Unexpected error:', error)
  }
}

// Run the function
createExecuteFunction()
