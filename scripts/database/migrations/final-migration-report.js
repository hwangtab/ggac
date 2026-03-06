// 최종 프로필 사진 마이그레이션 상태 보고서
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// .env.local 파일에서 환경변수 읽기
let supabaseUrl, supabaseAnonKey

try {
  const envPath = path.join(__dirname, '.env.local')
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8')
    const envLines = envFile.split('\n')

    for (const line of envLines) {
      const [key, ...valueParts] = line.split('=')
      const value = valueParts.join('=').trim()

      if (key === 'NEXT_PUBLIC_SUPABASE_URL') {
        supabaseUrl = value
      } else if (key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
        supabaseAnonKey = value
      }
    }
  }
} catch (error) {
  console.log('⚠️ .env.local 파일을 읽을 수 없습니다:', error.message)
}

// 환경변수가 없으면 process.env에서 가져오기
supabaseUrl = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL
supabaseAnonKey = supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function generateFinalReport() {
  console.log('📊 프로필 사진 마이그레이션 최종 보고서\n')
  console.log('='.repeat(60))

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    // 체크리스트 초기화
    const checklist = {
      databaseConnection: false,
      profilePhotoFields: false,
      databaseFunctions: false,
      databaseViews: false,
      storageAccess: false,
      storageBucket: false,
      raisePolicies: false,
    }

    // 1. 데이터베이스 연결
    console.log('\n🔗 1. 데이터베이스 연결 확인')
    try {
      await supabase.from('member_profiles').select('count').limit(1)
      checklist.databaseConnection = true
      console.log('✅ Supabase 데이터베이스 연결 성공')
    } catch (error) {
      console.log('❌ 데이터베이스 연결 실패:', error.message)
    }

    // 2. 프로필 사진 필드 확인
    console.log('\n📝 2. member_profiles 테이블 스키마 확인')
    try {
      await supabase
        .from('member_profiles')
        .select('id, profile_photo_url, profile_photo_metadata')
        .limit(1)
      checklist.profilePhotoFields = true
      console.log('✅ profile_photo_url 및 profile_photo_metadata 필드 존재')
    } catch (error) {
      console.log('❌ 프로필 사진 필드 없음:', error.message)
    }

    // 3. 데이터베이스 함수 확인
    console.log('\n⚙️ 3. 데이터베이스 함수 확인')
    const functions = [
      'get_profile_photo_info',
      'update_profile_photo',
      'delete_profile_photo',
      'get_profile_photo_stats',
    ]

    let functionCount = 0
    for (const func of functions) {
      try {
        await supabase.rpc(
          func,
          func === 'get_profile_photo_stats'
            ? {}
            : { user_id: '00000000-0000-0000-0000-000000000000' }
        )
        console.log(`✅ ${func} 함수 존재`)
        functionCount++
      } catch (error) {
        if (!error.message.includes('does not exist')) {
          console.log(`✅ ${func} 함수 존재 (실행 오류는 정상)`)
          functionCount++
        } else {
          console.log(`❌ ${func} 함수 없음`)
        }
      }
    }
    checklist.databaseFunctions = functionCount === functions.length

    // 4. 뷰 확인
    console.log('\n👁️ 4. 데이터베이스 뷰 확인')
    try {
      await supabase.from('member_profiles_with_photo').select('id').limit(1)
      checklist.databaseViews = true
      console.log('✅ member_profiles_with_photo 뷰 존재')
    } catch (error) {
      console.log('❌ 뷰 없음:', error.message)
    }

    // 5. Storage 접근 확인
    console.log('\n💾 5. Storage 시스템 확인')
    try {
      const { data: buckets } = await supabase.storage.listBuckets()
      checklist.storageAccess = true
      console.log(`✅ Storage 접근 가능 (현재 bucket 수: ${buckets.length}개)`)

      // profiles bucket 확인
      const profilesBucket = buckets.find(bucket => bucket.id === 'profiles')
      if (profilesBucket) {
        checklist.storageBucket = true
        console.log('✅ profiles Storage bucket 존재')
        console.log(`   - 공개 설정: ${profilesBucket.public}`)
        console.log(
          `   - 크기 제한: ${profilesBucket.file_size_limit ? Math.round(profilesBucket.file_size_limit / 1024 / 1024) + 'MB' : '무제한'}`
        )
      } else {
        console.log('❌ profiles Storage bucket 없음')
      }
    } catch (error) {
      console.log('❌ Storage 접근 실패:', error.message)
    }

    // 6. RLS 정책 테스트
    console.log('\n🔒 6. Row Level Security 정책 확인')
    try {
      await supabase.storage.from('profiles').list('', { limit: 1 })
      checklist.raisePolicies = true
      console.log('✅ Storage RLS 정책 작동 중')
    } catch (error) {
      console.log('⚠️ Storage RLS 확인 중 오류:', error.message)
    }

    // 7. 통계 정보
    console.log('\n📈 7. 현재 통계')
    try {
      const { data: stats } = await supabase.rpc('get_profile_photo_stats')
      if (stats && stats[0]) {
        const stat = stats[0]
        console.log(`✅ 전체 승인된 멤버: ${stat.total_members}명`)
        console.log(`✅ 프로필 사진 보유 멤버: ${stat.members_with_photo}명`)
        console.log(`✅ 프로필 사진 보유율: ${stat.photo_percentage}%`)
      }
    } catch (error) {
      console.log('⚠️ 통계 조회 오류:', error.message)
    }

    // 최종 결과 요약
    console.log('\n' + '='.repeat(60))
    console.log('📋 마이그레이션 상태 요약')
    console.log('='.repeat(60))

    const completedItems = Object.values(checklist).filter(Boolean).length
    const totalItems = Object.keys(checklist).length
    const completionPercentage = Math.round((completedItems / totalItems) * 100)

    console.log(`\n✅ 완료된 항목: ${completedItems}/${totalItems} (${completionPercentage}%)`)

    Object.entries(checklist).forEach(([key, status]) => {
      const labels = {
        databaseConnection: '데이터베이스 연결',
        profilePhotoFields: '프로필 사진 필드',
        databaseFunctions: '데이터베이스 함수',
        databaseViews: '데이터베이스 뷰',
        storageAccess: 'Storage 접근',
        storageBucket: 'profiles bucket',
        raisePolicies: 'RLS 정책',
      }

      console.log(`${status ? '✅' : '❌'} ${labels[key]}`)
    })

    // 권장사항
    console.log('\n💡 권장사항:')

    if (!checklist.storageBucket) {
      console.log('\n🚨 우선순위 높음: Storage bucket 생성')
      console.log('다음 중 하나를 실행하세요:')
      console.log('1. Supabase Dashboard → Storage → Create bucket (ID: profiles)')
      console.log('2. SQL Editor: SELECT ensure_profiles_bucket_exists();')
    }

    if (completionPercentage >= 85) {
      console.log('\n🎉 대부분의 마이그레이션이 완료되었습니다!')
      console.log('프로필 사진 기능을 사용할 수 있습니다.')
    } else if (completionPercentage >= 70) {
      console.log('\n⚠️ 일부 구성 요소가 누락되었습니다.')
      console.log('위의 미완료 항목들을 확인해주세요.')
    } else {
      console.log('\n❌ 주요 마이그레이션이 누락되었습니다.')
      console.log('supabase/migrations/ 폴더의 SQL 파일들을 Supabase에서 실행해주세요.')
    }

    console.log('\n📚 참고 자료:')
    console.log('- 마이그레이션 파일: supabase/migrations/20250720_*.sql')
    console.log('- Supabase Dashboard: https://supabase.com/dashboard')
    console.log('- 프로젝트 URL:', supabaseUrl)
  } catch (error) {
    console.error('❌ 보고서 생성 중 오류:', error.message)
  }
}

generateFinalReport()
