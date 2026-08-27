// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// SQL 파일을 읽어 Supabase `execute_sql` RPC로 한 문장씩 실행하려 한다
// (그 RPC는 `scripts/database/setup/create-execute-function.js`가 만들던 것이다).
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
// 스키마 변경은 drizzle-kit 마이그레이션(`npm run db:generate` →
// `src/db/migrations/`)으로 하고, 임시 조회는 `turso db shell ggac-prod`로 한다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase에 임의 SQL을 실행합니다. 스키마 변경은 drizzle-kit, ' +
    '임시 조회는 turso db shell ggac-prod 입니다.'
)
process.exit(1)
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Note: This requires service role key for DDL operations
// For now, we'll try with the anon key to see what happens
const supabase = createClient(supabaseUrl, supabaseKey)

async function runSQLScript(filePath) {
  try {
    console.log(`Reading SQL script from: ${filePath}`)
    const sqlScript = fs.readFileSync(filePath, 'utf8')
    console.log('SQL Script content:')
    console.log(sqlScript)
    console.log('\n=====================================\n')

    // Split by semicolon and execute each statement
    const statements = sqlScript
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    console.log(`Found ${statements.length} SQL statements to execute`)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      console.log(`\nExecuting statement ${i + 1}:`)
      console.log(statement)

      try {
        const { data, error } = await supabase.rpc('execute_sql', {
          sql_query: statement,
        })

        if (error) {
          console.error(`❌ Error executing statement ${i + 1}:`, error)
          // Continue with next statement
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully`)
          if (data) {
            console.log('Result:', data)
          }
        }
      } catch (err) {
        console.error(`❌ Exception executing statement ${i + 1}:`, err.message)
      }
    }

    console.log('\n=====================================')
    console.log('SQL script execution completed')
  } catch (error) {
    console.error('Error running SQL script:', error)
  }
}

// Get file path from command line argument
const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node run-sql-script.js <path-to-sql-file>')
  process.exit(1)
}

runSQLScript(filePath)
  .then(() => {
    console.log('Script execution finished')
    process.exit(0)
  })
  .catch(error => {
    console.error('Script execution failed:', error)
    process.exit(1)
  })
