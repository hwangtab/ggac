// 회원 테이블 컬럼 확인 스크립트
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-key'

if (!supabaseUrl.includes('supabase.co') || !supabaseServiceKey.startsWith('eyJ')) {
  console.log('⚠️  환경변수 설정이 필요합니다:')
  console.log('NEXT_PUBLIC_SUPABASE_URL=your-supabase-url')
  console.log('SUPABASE_SERVICE_ROLE_KEY=your-service-key')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function verifyMemberColumns() {
  try {
    console.log('🔍 member_profiles 테이블 컬럼 확인 중...\n')

    // 테이블 스키마 확인
    const { data: columns, error } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable, column_default')
      .eq('table_name', 'member_profiles')
      .eq('table_schema', 'public')

    if (error) {
      console.error('❌ 스키마 조회 오류:', error)
      return
    }

    console.log('📋 member_profiles 테이블 컬럼 목록:')
    console.log('─'.repeat(80))
    
    const requiredColumns = [
      'approved_by',
      'approved_at', 
      'rejected_by',
      'is_suspended',
      'suspension_reason',
      'suspension_until'
    ]

    let missingColumns = []
    let existingColumns = []

    columns.forEach(col => {
      const isRequired = requiredColumns.includes(col.column_name)
      const status = isRequired ? '✅ 필수' : '   일반'
      console.log(`${status} ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)} ${col.is_nullable}`)
      
      if (isRequired) {
        existingColumns.push(col.column_name)
      }
    })

    // 누락된 컬럼 확인
    missingColumns = requiredColumns.filter(col => !existingColumns.includes(col))

    console.log('\n📊 컬럼 검증 결과:')
    console.log('─'.repeat(50))
    
    if (missingColumns.length === 0) {
      console.log('✅ 모든 필수 컬럼이 존재합니다!')
      existingColumns.forEach(col => {
        console.log(`   ✅ ${col}`)
      })
    } else {
      console.log('❌ 누락된 컬럼:')
      missingColumns.forEach(col => {
        console.log(`   ❌ ${col}`)
      })
      console.log('❌ 존재하는 컬럼:')
      existingColumns.forEach(col => {
        console.log(`   ✅ ${col}`)
      })
    }

    // 샘플 데이터 확인
    console.log('\n🧪 샘플 회원 데이터 확인:')
    console.log('─'.repeat(50))
    
    const { data: members, error: memberError } = await supabase
      .from('member_profiles')
      .select(`
        id, display_name, registration_status, is_active, 
        approved_by, approved_at, rejected_by, 
        is_suspended, suspension_reason, suspension_until
      `)
      .limit(3)

    if (memberError) {
      console.error('❌ 회원 데이터 조회 오류:', memberError)
    } else {
      members.forEach(member => {
        console.log(`👤 ${member.display_name} (${member.registration_status})`)
        console.log(`   approved_by: ${member.approved_by || 'null'}`)
        console.log(`   approved_at: ${member.approved_at || 'null'}`)
        console.log(`   rejected_by: ${member.rejected_by || 'null'}`)
        console.log(`   is_suspended: ${member.is_suspended}`)
        console.log('')
      })
    }

    // API 테스트
    console.log('🧪 API 접근 테스트:')
    console.log('─'.repeat(50))
    
    const testResponse = await fetch(`${supabaseUrl.replace('supabase.co', 'supabase.co')}/rest/v1/member_profiles?select=id,display_name&limit=1`, {
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (testResponse.ok) {
      console.log('✅ Supabase API 접근 성공')
    } else {
      console.log('❌ Supabase API 접근 실패:', testResponse.status)
    }

  } catch (error) {
    console.error('❌ 검증 중 오류 발생:', error)
  }
}

verifyMemberColumns()