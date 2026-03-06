// 회원 상태 실시간 확인 스크립트
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

async function checkMemberStatus() {
  try {
    console.log('🔍 실시간 회원 상태 확인')
    console.log('─'.repeat(60))
    console.log(`대상 회원 ID: ${memberId}`)
    console.log(`확인 시간: ${new Date().toLocaleString('ko-KR')}`)
    console.log('')

    // 1. 현재 회원 상태 조회
    const { data: member, error } = await supabase
      .from('member_profiles')
      .select(
        `
        id, display_name, email, real_name,
        registration_status, is_active, is_admin, is_artist,
        approved_by, approved_at, rejected_by,
        is_suspended, suspension_reason, suspension_until,
        created_at, updated_at
      `
      )
      .eq('id', memberId)
      .single()

    if (error) {
      console.error('❌ 회원 조회 오류:', error)
      return
    }

    if (!member) {
      console.log('❌ 해당 ID의 회원을 찾을 수 없습니다.')
      return
    }

    // 2. 회원 정보 출력
    console.log('📋 현재 회원 정보:')
    console.log('─'.repeat(40))
    console.log(`👤 이름: ${member.display_name}`)
    console.log(`📧 이메일: ${member.email}`)
    console.log(`🆔 실명: ${member.real_name || '없음'}`)
    console.log('')

    console.log('📊 상태 정보:')
    console.log('─'.repeat(40))
    console.log(`📝 등록 상태: ${member.registration_status}`)
    console.log(`🔄 활성 상태: ${member.is_active ? '활성' : '비활성'}`)
    console.log(`👑 관리자: ${member.is_admin ? '예' : '아니오'}`)
    console.log(`🎨 아티스트: ${member.is_artist ? '예' : '아니오'}`)
    console.log(`⛔ 정지 상태: ${member.is_suspended ? '정지됨' : '정상'}`)
    console.log('')

    console.log('📅 시간 정보:')
    console.log('─'.repeat(40))
    console.log(`🎯 생성일: ${new Date(member.created_at).toLocaleString('ko-KR')}`)
    console.log(`✏️  수정일: ${new Date(member.updated_at).toLocaleString('ko-KR')}`)

    if (member.approved_by) {
      console.log(`✅ 승인자: ${member.approved_by}`)
      console.log(
        `✅ 승인일: ${member.approved_at ? new Date(member.approved_at).toLocaleString('ko-KR') : '없음'}`
      )
    }

    if (member.rejected_by) {
      console.log(`❌ 거부자: ${member.rejected_by}`)
    }

    // 3. 승인 가능 여부 확인
    console.log('')
    console.log('🔍 승인 가능성 분석:')
    console.log('─'.repeat(40))

    if (member.registration_status === 'pending') {
      console.log('✅ 승인 대기 상태 - 승인 가능')
    } else if (member.registration_status === 'approved') {
      console.log('⚠️  이미 승인된 상태')
    } else if (member.registration_status === 'rejected') {
      console.log('❌ 거부된 상태')
    }

    // 4. UPDATE 시뮬레이션 (실제 실행 안함)
    console.log('')
    console.log('🧪 승인 시뮬레이션:')
    console.log('─'.repeat(40))
    console.log('다음과 같이 변경될 예정:')
    console.log(`registration_status: ${member.registration_status} → approved`)
    console.log(`is_active: ${member.is_active} → true`)
    console.log(`approved_by: ${member.approved_by || 'null'} → [admin-user-id]`)
    console.log(`approved_at: ${member.approved_at || 'null'} → [현재시간]`)
    console.log(`updated_at: ${member.updated_at} → [현재시간]`)

    // 5. RLS 정책 확인
    console.log('')
    console.log('🔒 권한 검증:')
    console.log('─'.repeat(40))

    // 관리자 계정으로 업데이트 테스트 (실제 실행 안함)
    console.log('UPDATE 권한 테스트 (시뮬레이션):')
    console.log('✓ Service Role Key 사용 - 모든 권한 있음')
    console.log('✓ RLS 정책 우회 가능')

    return member
  } catch (error) {
    console.error('❌ 상태 확인 중 오류:', error)
  }
}

// 실행
checkMemberStatus().then(member => {
  if (member) {
    console.log('')
    console.log('💡 다음 단계:')
    console.log('1. 브라우저에서 승인 버튼 클릭')
    console.log('2. 이 스크립트를 다시 실행하여 변경 확인')
    console.log('3. 개발자 도구 Network 탭에서 API 응답 확인')
  }
})
