// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles`/`profiles`/`member_profiles_with_photo`를 조회해
// 프로필 사진 마이그레이션 상태를 보고한다.
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
// 스키마 정본은 `src/db/schema/`이고 마이그레이션은 drizzle-kit이 관리한다
// (`npm run db:generate` → `src/db/migrations/`, 적용은 `scripts/turso/README.md`
// 절차). Supabase 마이그레이션은 컷오버로 끝났다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase 스키마를 확인·변경합니다. 스키마 정본은 src/db/schema/ 이고 ' +
    '마이그레이션은 drizzle-kit이 관리합니다(scripts/turso/README.md).'
)
process.exit(1)
// 프로필 사진 마이그레이션 상태 확인 도구
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

async function checkProfilePhotoMigrations() {
  console.log('🔍 프로필 사진 마이그레이션 상태 확인 중...\n')

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    // 1. 기본 연결 테스트
    console.log('1️⃣ Supabase 연결 테스트...')
    const { data: connectionTest, error: connectionError } = await supabase
      .from('member_profiles')
      .select('count')
      .limit(1)

    if (connectionError) {
      console.log('❌ 연결 실패:', connectionError.message)
      return
    }
    console.log('✅ Supabase 연결 성공')

    // 2. member_profiles 테이블 스키마 확인
    console.log('\n2️⃣ member_profiles 테이블 스키마 확인...')

    // 프로필 사진 필드가 있는지 확인하기 위해 샘플 쿼리 실행
    const { data: schemaTest, error: schemaError } = await supabase
      .from('member_profiles')
      .select('id, profile_photo_url, profile_photo_metadata')
      .limit(1)

    if (schemaError) {
      if (schemaError.message.includes('column "profile_photo_url" does not exist')) {
        console.log('❌ profile_photo_url 컬럼이 존재하지 않습니다')
        console.log('📝 필요한 액션: 20250720_add_profile_photo_fields.sql 마이그레이션 실행')
        return
      } else if (schemaError.message.includes('column "profile_photo_metadata" does not exist')) {
        console.log('❌ profile_photo_metadata 컬럼이 존재하지 않습니다')
        console.log('📝 필요한 액션: 20250720_add_profile_photo_fields.sql 마이그레이션 실행')
        return
      } else {
        console.log('⚠️ 스키마 확인 중 오류:', schemaError.message)
        return
      }
    }
    console.log('✅ member_profiles 테이블에 프로필 사진 필드 존재')

    // 3. Storage bucket 확인
    console.log('\n3️⃣ Storage bucket 확인...')

    try {
      const { data: buckets, error: bucketError } = await supabase.storage.listBuckets()

      if (bucketError) {
        console.log('⚠️ Storage bucket 조회 오류:', bucketError.message)
      } else {
        const profilesBucket = buckets.find(bucket => bucket.id === 'profiles')

        if (profilesBucket) {
          console.log('✅ profiles Storage bucket 존재')
          console.log(`   - 공개 설정: ${profilesBucket.public ? '공개' : '비공개'}`)
          console.log(
            `   - 파일 크기 제한: ${profilesBucket.file_size_limit ? Math.round(profilesBucket.file_size_limit / 1024 / 1024) + 'MB' : '제한없음'}`
          )
          console.log(
            `   - 허용 파일 타입: ${profilesBucket.allowed_mime_types ? profilesBucket.allowed_mime_types.join(', ') : '모든 타입'}`
          )
        } else {
          console.log('❌ profiles Storage bucket이 존재하지 않습니다')
          console.log('📝 필요한 액션: 20250720_setup_profile_storage.sql 마이그레이션 실행')
          return
        }
      }
    } catch (storageError) {
      console.log('⚠️ Storage 접근 중 오류:', storageError.message)
    }

    // 4. 프로필 사진 관련 함수 존재 확인
    console.log('\n4️⃣ 데이터베이스 함수 확인...')

    const functionsToCheck = [
      'get_profile_photo_info',
      'update_profile_photo',
      'delete_profile_photo',
      'get_profile_photo_stats',
    ]

    for (const functionName of functionsToCheck) {
      try {
        // 함수 존재 여부를 확인하기 위해 테스트 호출
        const { error: funcError } = await supabase.rpc(
          functionName,
          functionName === 'get_profile_photo_stats'
            ? {}
            : { user_id: '00000000-0000-0000-0000-000000000000' }
        )

        if (funcError && funcError.message.includes('does not exist')) {
          console.log(`❌ ${functionName} 함수가 존재하지 않습니다`)
        } else {
          console.log(`✅ ${functionName} 함수 존재`)
        }
      } catch (e) {
        console.log(`⚠️ ${functionName} 함수 확인 중 오류:`, e.message)
      }
    }

    // 5. 뷰 존재 확인
    console.log('\n5️⃣ 뷰 존재 확인...')

    const { data: viewTest, error: viewError } = await supabase
      .from('member_profiles_with_photo')
      .select('id')
      .limit(1)

    if (viewError) {
      if (viewError.message.includes('does not exist')) {
        console.log('❌ member_profiles_with_photo 뷰가 존재하지 않습니다')
      } else {
        console.log('⚠️ 뷰 확인 중 오류:', viewError.message)
      }
    } else {
      console.log('✅ member_profiles_with_photo 뷰 존재')
    }

    // 6. Storage RLS 정책 테스트 (간접적)
    console.log('\n6️⃣ Storage 접근 권한 테스트...')

    try {
      // profiles bucket의 파일 목록 조회 시도
      const { data: files, error: listError } = await supabase.storage
        .from('profiles')
        .list('', { limit: 1 })

      if (listError) {
        if (listError.message.includes('row-level security')) {
          console.log('⚠️ Storage RLS 정책으로 인해 접근 제한됨 (정상)')
        } else {
          console.log('⚠️ Storage 파일 목록 조회 오류:', listError.message)
        }
      } else {
        console.log('✅ Storage 접근 가능')
        console.log(`   - 현재 파일 수: ${files.length}개`)
      }
    } catch (storageListError) {
      console.log('⚠️ Storage 목록 조회 중 오류:', storageListError.message)
    }

    // 7. 프로필 사진 통계
    console.log('\n7️⃣ 프로필 사진 통계...')

    try {
      const { data: stats, error: statsError } = await supabase.rpc('get_profile_photo_stats')

      if (statsError) {
        console.log('⚠️ 통계 조회 오류:', statsError.message)
      } else if (stats && stats.length > 0) {
        const stat = stats[0]
        console.log(`✅ 통계 조회 성공`)
        console.log(`   - 전체 승인된 멤버: ${stat.total_members}명`)
        console.log(`   - 프로필 사진 있는 멤버: ${stat.members_with_photo}명`)
        console.log(`   - 프로필 사진 보유율: ${stat.photo_percentage}%`)
      } else {
        console.log('⚠️ 통계 데이터 없음')
      }
    } catch (statsQueryError) {
      console.log('⚠️ 통계 함수 호출 중 오류:', statsQueryError.message)
    }

    // 8. 마이그레이션 상태 요약
    console.log('\n📋 마이그레이션 상태 요약:')
    console.log('✅ 성공한 항목들:')
    console.log('   - Supabase 연결')
    console.log('   - member_profiles 프로필 사진 필드')

    // 권장사항
    console.log('\n💡 권장사항:')
    console.log('1. 모든 마이그레이션이 적용되었는지 Supabase Dashboard에서 재확인')
    console.log('2. Storage bucket 설정이 올바른지 확인')
    console.log('3. RLS 정책이 의도대로 작동하는지 테스트')
    console.log('4. 실제 파일 업로드/다운로드 테스트 수행')
  } catch (error) {
    console.error('❌ 마이그레이션 확인 중 오류:', error.message)
  }
}

checkProfilePhotoMigrations()
