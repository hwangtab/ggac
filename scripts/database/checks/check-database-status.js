// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// DB 스키마·관리자 설정 상태를 Supabase에서 조회해 보고한다.
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
/**
 * Database Status Checker
 * Checks current database schema and admin setup
 */

const { createClient } = require('@supabase/supabase-js')

async function checkDatabaseStatus() {
  console.log('🔍 Checking Database Status...\n')

  // Use the public client to check basic connectivity
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Supabase environment variables not found')
    console.log('Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    console.log('1. 📊 Testing basic connectivity...')

    // Test basic connectivity by checking if we can query the member_profiles table
    const { data: profiles, error: profilesError } = await supabase
      .from('member_profiles')
      .select('id')
      .limit(1)

    if (profilesError) {
      console.log(`⚠️ Cannot access member_profiles table: ${profilesError.message}`)
      if (profilesError.message.includes('does not exist')) {
        console.log('❌ member_profiles table does not exist! Please run the initial migrations.')
        return
      }
    } else {
      console.log('✅ Basic database connectivity OK')
    }

    console.log('\n2. 📋 Checking required tables...')

    // Check for admin-specific tables by trying to query them
    const adminTables = ['member_status_history', 'member_login_history', 'member_bulk_operations']

    const tableStatus = []

    for (const tableName of adminTables) {
      try {
        const { error } = await supabase.from(tableName).select('id').limit(1)

        if (error) {
          if (error.message.includes('does not exist')) {
            console.log(`❌ Table '${tableName}' missing`)
            tableStatus.push({ table: tableName, exists: false })
          } else {
            console.log(`⚠️ Table '${tableName}' exists but has access issues: ${error.message}`)
            tableStatus.push({ table: tableName, exists: true, hasIssues: true })
          }
        } else {
          console.log(`✅ Table '${tableName}' exists and accessible`)
          tableStatus.push({ table: tableName, exists: true })
        }
      } catch (err) {
        console.log(`❌ Error checking table '${tableName}': ${err.message}`)
        tableStatus.push({ table: tableName, exists: false, error: err.message })
      }
    }

    console.log('\n3. 🏛️ Checking member_profiles table structure...')

    // Try to check if we can access some admin-specific columns
    const adminColumns = [
      'is_admin',
      'is_suspended',
      'suspension_reason',
      'profile_completeness_score',
      'verification_status',
      'membership_type',
      'engagement_score',
    ]

    for (const column of adminColumns) {
      try {
        const { error } = await supabase.from('member_profiles').select(column).limit(1)

        if (error) {
          console.log(`❌ Column '${column}' not accessible: ${error.message}`)
        } else {
          console.log(`✅ Column '${column}' exists`)
        }
      } catch (err) {
        console.log(`❌ Error checking column '${column}': ${err.message}`)
      }
    }

    console.log('\n4. 👑 Checking for admin users...')

    try {
      const { data: adminUsers, error: adminError } = await supabase
        .from('member_profiles')
        .select('display_name, email, is_admin, is_active, registration_status')
        .eq('is_admin', true)

      if (adminError) {
        console.log(`⚠️ Cannot check admin users: ${adminError.message}`)
      } else if (adminUsers && adminUsers.length > 0) {
        console.log(`✅ Found ${adminUsers.length} admin user(s):`)
        adminUsers.forEach(user => {
          const status =
            user.is_active && user.registration_status === 'approved' ? '✅ Active' : '⚠️ Inactive'
          console.log(`   ${status} ${user.display_name} (${user.email})`)
        })
      } else {
        console.log('❌ No admin users found')
      }
    } catch (err) {
      console.log(`❌ Error checking admin users: ${err.message}`)
    }

    console.log('\n📋 Summary and Next Steps:')

    const missingTables = tableStatus.filter(t => !t.exists)
    if (missingTables.length > 0) {
      console.log('\n❌ Missing admin tables:')
      missingTables.forEach(t => console.log(`   - ${t.table}`))
      console.log('\n📝 To fix this:')
      console.log('1. Go to your Supabase Dashboard > SQL Editor')
      console.log('2. Copy and run the contents of setup-admin-database.sql')
      console.log('3. Re-run this check script')
    } else {
      console.log('✅ All required tables appear to be present')
    }

    console.log('\n🔧 Admin Setup Instructions:')
    console.log('1. Sign up a user account through the normal signup flow')
    console.log('2. Note the email address of that user')
    console.log('3. Edit setup-admin-database.sql and replace admin@example.com with that email')
    console.log('4. Run the SQL script in Supabase Dashboard')
    console.log('5. That user will become an admin and can access /admin')
  } catch (error) {
    console.error('❌ Database check failed:', error.message)
  }
}

// Load environment variables from .env.local
function loadEnvFromFile() {
  try {
    const fs = require('fs')
    const path = require('path')

    const envPath = path.join(__dirname, '.env.local')
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8')
      const lines = envContent.split('\n')

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, value] = trimmed.split('=')
          if (key && value) {
            process.env[key] = value
          }
        }
      }
      console.log('✅ Loaded environment variables from .env.local')
    } else {
      console.log('⚠️ .env.local file not found')
    }
  } catch (error) {
    console.log('⚠️ Could not load .env.local:', error.message)
  }
}

if (require.main === module) {
  loadEnvFromFile()
  checkDatabaseStatus()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Check failed:', error)
      process.exit(1)
    })
}

module.exports = { checkDatabaseStatus }
