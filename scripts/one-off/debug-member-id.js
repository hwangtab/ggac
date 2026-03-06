// 특정 회원 ID 디버깅 스크립트
const { createClient } = require('@supabase/supabase-js')

const memberId = '65f75aa0-d36d-4ba5-8884-8dcdd9b71e01'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-key'

if (!supabaseUrl.includes('supabase.co') || !supabaseServiceKey.startsWith('eyJ')) {
  console.log('⚠️  환경변수 설정이 필요합니다:')
  console.log('NEXT_PUBLIC_SUPABASE_URL=your-supabase-url')
  console.log('SUPABASE_SERVICE_ROLE_KEY=your-service-key')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function debugMemberId() {
  try {
    console.log(`🔍 회원 ID ${memberId} 검증 중...\n`)

    // 1. 정확한 ID로 회원 조회
    console.log('1️⃣ 정확한 ID로 회원 조회:')
    const { data: exactMatch, error: exactError } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('id', memberId)

    if (exactError) {
      console.error('❌ 조회 오류:', exactError)
    } else {
      console.log(`✅ 조회 결과: ${exactMatch.length}개 행`)
      if (exactMatch.length === 0) {
        console.log('❌ 해당 ID의 회원이 존재하지 않습니다!')
      } else if (exactMatch.length > 1) {
        console.log('❌ 중복된 ID가 발견되었습니다!')
        exactMatch.forEach((member, index) => {
          console.log(`   ${index + 1}. ${member.display_name} (${member.email})`)
        })
      } else {
        const member = exactMatch[0]
        console.log(`✅ 정상: ${member.display_name} (${member.email})`)
        console.log(`   상태: ${member.registration_status}`)
        console.log(`   활성: ${member.is_active}`)
        console.log(`   생성일: ${member.created_at}`)
      }
    }

    // 2. ID 패턴 검증
    console.log('\n2️⃣ UUID 패턴 검증:')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const isValidUUID = uuidPattern.test(memberId)
    console.log(`UUID 형식: ${isValidUUID ? '✅ 유효' : '❌ 무효'}`)

    // 3. 비슷한 ID 검색
    console.log('\n3️⃣ 비슷한 ID 검색:')
    const { data: similarIds, error: similarError } = await supabase
      .from('member_profiles')
      .select('id, display_name, email')
      .ilike('id', `${memberId.substring(0, 8)}%`)

    if (similarError) {
      console.error('❌ 비슷한 ID 검색 오류:', similarError)
    } else {
      console.log(`검색 결과: ${similarIds.length}개`)
      similarIds.forEach(member => {
        const isExact = member.id === memberId
        console.log(`${isExact ? '🎯' : '  '} ${member.id} - ${member.display_name}`)
      })
    }

    // 4. 전체 회원 수 확인
    console.log('\n4️⃣ 전체 회원 수 확인:')
    const { count, error: countError } = await supabase
      .from('member_profiles')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      console.error('❌ 카운트 오류:', countError)
    } else {
      console.log(`✅ 전체 회원 수: ${count}명`)
    }

    // 5. 최근 가입한 회원들
    console.log('\n5️⃣ 최근 가입 회원 (최신 5명):')
    const { data: recentMembers, error: recentError } = await supabase
      .from('member_profiles')
      .select('id, display_name, registration_status, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    if (recentError) {
      console.error('❌ 최근 회원 조회 오류:', recentError)
    } else {
      recentMembers.forEach((member, index) => {
        const isTarget = member.id === memberId
        console.log(
          `${isTarget ? '🎯' : `${index + 1}.`} ${member.display_name} (${member.registration_status})`
        )
        console.log(`   ID: ${member.id}`)
        console.log(`   생성: ${new Date(member.created_at).toLocaleString('ko-KR')}`)
        console.log('')
      })
    }

    // 6. UPDATE 시뮬레이션 (실제 변경 없이)
    console.log('6️⃣ UPDATE 시뮬레이션:')
    console.log('실행할 쿼리 구조:')
    console.log('UPDATE member_profiles')
    console.log(
      `SET registration_status = 'approved', is_active = true, approved_by = 'admin-id', approved_at = NOW()`
    )
    console.log(`WHERE id = '${memberId}'`)
    console.log('RETURNING *;')
  } catch (error) {
    console.error('❌ 전체 검증 중 오류:', error)
  }
}

debugMemberId()
