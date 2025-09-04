const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
require('dotenv').config()

// Supabase configuration via env vars (no hardcoded secrets)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('\n❌ Missing Supabase env vars. Please set:')
  console.error('   NEXT_PUBLIC_SUPABASE_URL')
  console.error('   SUPABASE_SERVICE_ROLE_KEY (service role)')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function applyMigration() {
  console.log('🚀 데이터베이스 마이그레이션 적용 시작...\n')

  try {
    // 마이그레이션 SQL 파일 읽기
    const filePath =
      process.argv[2] || 'supabase/migrations/20250903_optimize_posts_performance.sql'
    const migrationSQL = fs.readFileSync(filePath, 'utf8')

    // SQL 문을 세미콜론으로 분리
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

    console.log(`📝 실행할 SQL 문 개수: ${statements.length}\n`)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      console.log(`${i + 1}. 실행 중: ${statement.substring(0, 60)}...`)

      // 실행은 Supabase SQL Editor 사용을 권장합니다.
      // 여기는 안전상 실제 실행 대신 준비만 하고 종료합니다.
      console.log(
        '   ℹ️ 이 스크립트는 현재 SQL을 출력만 합니다. Supabase SQL Editor에서 실행하세요.'
      )
      console.log(statement)
    }

    console.log(
      '\n✅ SQL statements printed above. Copy/paste into Supabase SQL Editor to execute.'
    )
  } catch (error) {
    console.error('❌ 마이그레이션 적용 실패:', error.message)
  }
}

applyMigration()
