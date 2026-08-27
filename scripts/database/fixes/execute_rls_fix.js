// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles`의 RLS 정책을 SQL 파일로 적용하려 한다.
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
const fs = require('fs')
const path = require('path')

// Read environment variables
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl)
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey)
  process.exit(1)
}

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Read the SQL file
const sqlFile = path.join(__dirname, 'fix_rls_policies_immediate.sql')
const sqlContent = fs.readFileSync(sqlFile, 'utf8')

// Split SQL into individual statements
const statements = sqlContent
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

async function executeSQLStatements() {
  console.log('Starting RLS policy fix...')

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]
    console.log(`\nExecuting statement ${i + 1}/${statements.length}:`)
    console.log(statement.substring(0, 100) + (statement.length > 100 ? '...' : ''))

    try {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: statement + ';',
      })

      if (error) {
        console.error('Error executing statement:', error)
        // Continue with next statement for non-critical errors
      } else {
        console.log('✓ Statement executed successfully')
      }
    } catch (err) {
      console.error('Exception executing statement:', err)
      // Continue with next statement
    }
  }

  console.log('\nRLS policy fix completed.')
}

// Also check user profile after
async function checkUserProfile() {
  const userId = 'ab6617b4-532c-4820-8a75-553139868b2a'

  console.log('\n=== Checking user profile ===')

  try {
    const { data, error } = await supabase.from('member_profiles').select('*').eq('id', userId)

    if (error) {
      console.error('Error fetching user profile:', error)
    } else {
      console.log('User profile data:', data)
    }
  } catch (err) {
    console.error('Exception checking user profile:', err)
  }
}

// Execute the fixes
executeSQLStatements()
  .then(() => checkUserProfile())
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
