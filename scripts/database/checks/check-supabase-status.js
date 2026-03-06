// Supabase 상태 확인 도구
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

async function checkSupabaseStatus() {
  console.log('🔍 Supabase 연결 상태 확인 중...\n')

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    // 1. 기본 연결 테스트
    console.log('1️⃣ 기본 연결 테스트...')
    const startTime = Date.now()

    const { data, error } = await supabase.from('member_profiles').select('count').limit(1)

    const responseTime = Date.now() - startTime

    if (error) {
      if (error.message.includes('rate limit') || error.code === '429') {
        console.log('❌ Rate Limit 활성화 - 요청 제한 상태')
        console.log('⏰ 예상 대기 시간: 5-10분')
        console.log('💡 해결책:')
        console.log('   - 잠시 기다린 후 다시 시도')
        console.log('   - 다른 브라우저 또는 시크릿 모드 사용')
        console.log('   - 로컬스토리지 클리어')
        return
      } else {
        console.log('⚠️ 연결 오류:', error.message)
      }
    } else {
      console.log(`✅ 연결 성공 (응답 시간: ${responseTime}ms)`)
    }

    // 2. 인증 상태 확인
    console.log('\n2️⃣ 인증 시스템 상태...')
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) {
        if (sessionError.message.includes('rate limit')) {
          console.log('❌ 인증 시스템 Rate Limit')
        } else {
          console.log('⚠️ 인증 오류:', sessionError.message)
        }
      } else {
        console.log('✅ 인증 시스템 정상')
        if (session) {
          console.log(`📧 현재 로그인: ${session.user.email}`)
        } else {
          console.log('👤 현재 비로그인 상태')
        }
      }
    } catch (authError) {
      console.log('❌ 인증 테스트 실패:', authError.message)
    }

    // 3. 프로젝트 정보
    console.log('\n3️⃣ 프로젝트 정보...')
    console.log(`🌐 Supabase URL: ${supabaseUrl}`)
    console.log(`🔑 Anonymous Key: ${supabaseAnonKey.substring(0, 20)}...`)

    // 4. 권장 사항
    console.log('\n💡 Rate Limit 해결 방법:')
    console.log('1. 즉시 해결:')
    console.log('   - 5-10분 대기 후 재시도')
    console.log('   - 브라우저 시크릿 모드 사용')
    console.log('   - localStorage.clear() 실행')
    console.log('')
    console.log('2. 장기적 해결:')
    console.log('   - Supabase Pro 플랜 고려 (더 높은 Rate Limit)')
    console.log('   - 요청 최적화 (불필요한 API 호출 제거)')
    console.log('   - 클라이언트 사이드 캐싱 구현')
  } catch (error) {
    console.error('❌ 상태 확인 중 오류:', error.message)

    if (error.message.includes('rate limit') || error.status === 429) {
      console.log('\n🚨 Rate Limit 감지!')
      console.log('현재 Supabase 요청 한도에 도달했습니다.')
      console.log('')
      console.log('📝 해결 단계:')
      console.log('1. 브라우저 개발자 도구 열기')
      console.log('2. Console 탭에서 다음 명령어 실행:')
      console.log('   localStorage.clear();')
      console.log('   sessionStorage.clear();')
      console.log('   location.reload();')
      console.log('3. 5-10분 후 다시 시도')
    }
  }
}

checkSupabaseStatus()
