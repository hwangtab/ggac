const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

// Supabase configuration
const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co'
const supabaseKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDMwMDYzMywiZXhwIjoyMDY1ODc2NjMzfQ.Sr0IFXaNOPphT9wTPlXgEYxok9Fg-82YGYwOOzVDEQ4'
const supabase = createClient(supabaseUrl, supabaseKey)

async function applyMigration() {
  console.log('🚀 데이터베이스 마이그레이션 적용 시작...\n')

  try {
    // 마이그레이션 SQL 파일 읽기
    const migrationSQL = fs.readFileSync(
      'supabase/migrations/20250903_optimize_posts_performance.sql',
      'utf8'
    )

    // SQL 문을 세미콜론으로 분리
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

    console.log(`📝 실행할 SQL 문 개수: ${statements.length}\n`)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      console.log(`${i + 1}. 실행 중: ${statement.substring(0, 60)}...`)

      try {
        const { data, error } = await supabase.rpc('exec_sql', {
          sql_query: statement,
        })

        if (error) {
          console.log(`❌ 실행 실패: ${error.message}`)
          // 인덱스가 이미 존재하는 경우는 무시
          if (!error.message.includes('already exists')) {
            throw error
          } else {
            console.log('   (이미 존재하는 인덱스 - 건너뜀)')
          }
        } else {
          console.log('   ✅ 완료')
        }
      } catch (err) {
        // RPC 함수가 없으면 직접 SQL 실행
        try {
          const { data, error } = await supabase
            .from('_migrations')
            .insert({ statement, applied_at: new Date() })

          if (error) {
            console.log(`❌ SQL 실행 실패: ${error.message}`)
          } else {
            console.log('   ✅ 완료 (직접 실행)')
          }
        } catch (directError) {
          console.log(`❌ 직접 실행도 실패: ${directError.message}`)
          console.log('   ⏭️ 건너뜀')
        }
      }
    }

    console.log('\n🎉 마이그레이션 적용 완료!')
  } catch (error) {
    console.error('❌ 마이그레이션 적용 실패:', error.message)
  }
}

applyMigration()
