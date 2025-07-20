/**
 * Supabase Storage bucket 직접 생성 스크립트
 * 관리자 권한으로 Storage bucket을 생성합니다
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

// .env.local 파일 직접 읽기
const envPath = '.env.local'
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=')
    if (key && value) {
      process.env[key] = value
    }
  })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase 환경 변수가 설정되지 않았습니다')
  console.log('URL:', supabaseUrl)
  console.log('Key exists:', !!supabaseAnonKey)
  process.exit(1)
}

console.log('🔗 Supabase 연결 정보:')
console.log('URL:', supabaseUrl)
console.log('Key:', supabaseAnonKey?.substring(0, 20) + '...')

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function createProfilesBucket() {
  console.log('🚀 Storage bucket 생성 프로세스 시작...\n')

  try {
    // 1. 현재 bucket 목록 확인
    console.log('1️⃣ 현재 bucket 목록 확인...')
    const { data: buckets, error: listError } = await supabase.storage.listBuckets()
    
    if (listError) {
      console.error('❌ Bucket 목록 조회 실패:', listError.message)
      return
    }

    console.log(`✅ 현재 bucket 수: ${buckets?.length || 0}개`)
    
    const profilesBucketExists = buckets?.some(bucket => bucket.id === 'profiles')
    if (profilesBucketExists) {
      console.log('✅ profiles bucket이 이미 존재합니다!')
      return
    }

    // 2. profiles bucket 생성
    console.log('\n2️⃣ profiles bucket 생성 중...')
    const { data, error } = await supabase.storage.createBucket('profiles', {
      public: true,
      fileSizeLimit: 2097152, // 2MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    })

    if (error) {
      console.error('❌ Bucket 생성 실패:', error.message)
      console.log('\n💡 대안: Supabase Dashboard에서 수동으로 생성해보세요:')
      console.log('1. https://supabase.com/dashboard 접속')
      console.log('2. Storage → Create new bucket')
      console.log('3. Bucket ID: profiles')
      console.log('4. Public: true')
      console.log('5. File size limit: 2MB')
      return
    }

    console.log('✅ profiles bucket 생성 성공!')
    console.log('📋 Bucket 정보:', data)

    // 3. 재확인
    console.log('\n3️⃣ 생성 결과 재확인...')
    const { data: updatedBuckets } = await supabase.storage.listBuckets()
    const newProfilesBucket = updatedBuckets?.find(bucket => bucket.id === 'profiles')
    
    if (newProfilesBucket) {
      console.log('✅ profiles bucket 생성 및 확인 완료!')
      console.log('📋 최종 정보:', {
        id: newProfilesBucket.id,
        name: newProfilesBucket.name,
        public: newProfilesBucket.public,
        file_size_limit: newProfilesBucket.file_size_limit,
        allowed_mime_types: newProfilesBucket.allowed_mime_types
      })
      
      console.log('\n🎉 프로필 사진 업로드 기능이 활성화되었습니다!')
      console.log('👉 이제 웹사이트에서 마이페이지 → 개인 프로필에서 프로필 사진을 업로드할 수 있습니다.')
    } else {
      console.log('⚠️ bucket 생성이 완료되었지만 확인되지 않았습니다')
    }

  } catch (error) {
    console.error('❌ 처리 중 오류 발생:', error.message)
  }
}

createProfilesBucket()