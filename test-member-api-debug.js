// 회원 API 디버깅 테스트
async function testMemberAPI() {
  const baseUrl = 'http://localhost:3001'
  const memberId = '65f75aa0-d36d-4ba5-8884-8dcdd9b71e01'
  
  console.log('🧪 회원 승인 API 테스트 시작')
  console.log('─'.repeat(50))
  
  try {
    // 1. 먼저 회원 정보 조회 (GET 요청)
    console.log('1️⃣ 회원 정보 조회 중...')
    const getMembersResponse = await fetch(`${baseUrl}/api/admin/members?limit=1`)
    
    if (!getMembersResponse.ok) {
      console.log('❌ 회원 목록 조회 실패:', getMembersResponse.status)
      const errorText = await getMembersResponse.text()
      console.log('응답:', errorText)
      return
    }
    
    const membersData = await getMembersResponse.json()
    console.log('✅ 회원 목록 조회 성공')
    console.log('회원 수:', membersData.members?.length || 0)
    
    if (membersData.members && membersData.members.length > 0) {
      const firstMember = membersData.members[0]
      console.log('첫 번째 회원:', {
        id: firstMember.id,
        name: firstMember.display_name,
        status: firstMember.registration_status,
        is_active: firstMember.is_active
      })
    }
    
    // 2. 승인 API 테스트 (실제 요청은 하지 않고 구조만 확인)
    console.log('\n2️⃣ API 요청 구조 확인')
    
    const testPayload = {
      action: 'approve'
    }
    
    console.log('요청 URL:', `${baseUrl}/api/admin/members/${memberId}`)
    console.log('요청 메서드: PATCH')
    console.log('요청 페이로드:', testPayload)
    
    // 실제 테스트는 주석 처리 (실제 데이터 변경 방지)
    /*
    const response = await fetch(`${baseUrl}/api/admin/members/${memberId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload)
    })
    
    console.log('응답 상태:', response.status)
    const result = await response.text()
    console.log('응답:', result)
    */
    
    console.log('\n⚠️  실제 API 호출은 주석 처리됨 (데이터 보호)')
    console.log('📝 브라우저에서 직접 테스트하여 서버 로그를 확인하세요.')
    
  } catch (error) {
    console.error('❌ 테스트 중 오류:', error)
  }
}

// 환경 확인
console.log('🔍 환경 정보:')
console.log('Node.js 버전:', process.version)
console.log('현재 시간:', new Date().toISOString())
console.log('')

testMemberAPI()