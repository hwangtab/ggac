// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `posts`·`post_attachments`·`post_likes`·`member_profiles`의
// 존재·행수를 조회해 보고한다.
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
 * Posts Tables Status Checker
 * Specifically checks post_attachments and post_likes tables
 */

const { createClient } = require('@supabase/supabase-js')

async function checkPostsTables() {
  console.log('🔍 Checking Posts-related Tables...\\n')

  // Load environment variables from .env.local
  const fs = require('fs')
  const path = require('path')

  try {
    const envPath = path.join(__dirname, '.env.local')
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8')
      const lines = envContent.split('\\n')

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
    }
  } catch (error) {
    console.log('⚠️ Could not load .env.local:', error.message)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Supabase environment variables not found')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    console.log('1. 📊 Checking posts table structure...')

    // Check posts table columns
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('id, like_count')
      .limit(1)

    if (postsError) {
      console.log(`❌ Cannot access posts table: ${postsError.message}`)
    } else {
      console.log('✅ Posts table accessible')
      if (posts && posts.length > 0 && 'like_count' in posts[0]) {
        console.log('✅ like_count column exists in posts')
      } else {
        console.log('❌ like_count column missing in posts')
      }
    }

    console.log('\\n2. 📋 Checking post_attachments table...')

    const { data: attachments, error: attachmentsError } = await supabase
      .from('post_attachments')
      .select('id')
      .limit(1)

    if (attachmentsError) {
      if (attachmentsError.message.includes('does not exist')) {
        console.log('❌ post_attachments table does not exist')
      } else {
        console.log(
          `⚠️ post_attachments table exists but has access issues: ${attachmentsError.message}`
        )
      }
    } else {
      console.log('✅ post_attachments table exists and accessible')
    }

    console.log('\\n3. 📋 Checking post_likes table...')

    const { data: likes, error: likesError } = await supabase
      .from('post_likes')
      .select('id')
      .limit(1)

    if (likesError) {
      if (likesError.message.includes('does not exist')) {
        console.log('❌ post_likes table does not exist')
      } else {
        console.log(`⚠️ post_likes table exists but has access issues: ${likesError.message}`)
      }
    } else {
      console.log('✅ post_likes table exists and accessible')
    }

    console.log('\\n4. 👑 Checking admin users status...')

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

    console.log('\\n📋 Summary:')
    console.log('This shows the exact status of posts-related tables that the admin API needs.')
  } catch (error) {
    console.error('❌ Check failed:', error.message)
  }
}

if (require.main === module) {
  checkPostsTables()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Check failed:', error)
      process.exit(1)
    })
}

module.exports = { checkPostsTables }
