const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co'
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMDA2MzMsImV4cCI6MjA2NTg3NjYzM30.hkFnngs22eJfoIJP8q_WcgR2uMCT8iK7Z8aQmW46Iwk'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkTableStructure() {
  console.log('🔍 테이블 구조 확인...\n')

  try {
    // 1. 기본 테이블 조회 시도
    console.log('1. 기본 테이블 조회 시도')
    const { data: basicTest, error: basicError } = await supabase
      .from('member_profiles')
      .select('*')
      .limit(1)

    if (basicError) {
      console.log('❌ 기본 조회 실패:', basicError.message)
      console.log('   코드:', basicError.code)
    } else {
      console.log('✅ 기본 조회 성공')
      if (basicTest && basicTest.length > 0) {
        console.log('   첫 번째 행 컬럼들:', Object.keys(basicTest[0]))
      }
    }

    // 2. 다양한 컬럼명으로 시도
    console.log('\n2. 다양한 컬럼명으로 시도')
    const possibleColumns = ['id', 'user_id', 'profile_id', 'auth_id']

    for (const col of possibleColumns) {
      try {
        const { data, error } = await supabase.from('member_profiles').select(col).limit(1)

        if (error) {
          console.log(`❌ ${col}: ${error.message}`)
        } else {
          console.log(`✅ ${col}: 존재함`)
        }
      } catch (err) {
        console.log(`❌ ${col}: 예외 발생`)
      }
    }

    // 3. 모든 컬럼 확인
    console.log('\n3. 모든 컬럼 확인')
    const { data: allColumns, error: allError } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('id', 'non-existent-id') // 빈 결과를 위해

    if (allError) {
      console.log('❌ 전체 컬럼 조회 실패:', allError.message)
    } else {
      console.log('✅ 전체 컬럼 조회 성공 (빈 결과)')
    }

    // 4. 특정 사용자 ID로 다양한 컬럼 시도
    console.log('\n4. 특정 사용자 ID로 다양한 컬럼 시도')
    const TARGET_USER_ID = 'ab6617b4-532c-4820-8a75-553139868b2a'

    for (const col of possibleColumns) {
      try {
        const { data, error } = await supabase
          .from('member_profiles')
          .select('*')
          .eq(col, TARGET_USER_ID)

        if (error) {
          console.log(`❌ ${col}로 검색: ${error.message}`)
        } else {
          console.log(`✅ ${col}로 검색: 성공 (${data.length}개 행)`)
          if (data.length > 0) {
            console.log('   데이터:', data[0])
          }
        }
      } catch (err) {
        console.log(`❌ ${col}로 검색: 예외 발생`)
      }
    }
  } catch (error) {
    console.error('❌ 테이블 구조 확인 중 예외 발생:', error.message)
  }
}

checkTableStructure().catch(console.error)
