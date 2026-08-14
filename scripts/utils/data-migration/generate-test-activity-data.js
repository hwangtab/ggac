/**
 * 리포트 테스트용 활동 데이터 대량 생성 스크립트
 * 실제 사용자들의 과거 활동을 시뮬레이션하여 리포트에 표시할 데이터를 생성합니다.
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

// .env.local 파일 수동 로드
const envFile = fs.readFileSync('.env.local', 'utf8')
const envVars = {}
envFile.split('\n').forEach(line => {
  const [key, value] = line.split('=')
  if (key && value) {
    envVars[key.trim()] = value.trim()
  }
})
Object.assign(process.env, envVars)

// 활동 유형 정의
const ACTIVITY_TYPES = [
  'login',
  'page_viewed',
  'post_created',
  'post_updated',
  'comment_created',
  'like_added',
  'like_removed',
  'profile_updated',
  'file_uploaded',
  'search_performed',
]

// 페이지 경로 정의
const PAGE_PATHS = [
  '/',
  '/about',
  '/projects',
  '/artists',
  '/connect',
  '/board',
  '/board/write',
  '/mypage',
  '/mypage/profile',
  '/mypage/artist',
  '/admin',
  '/admin/members',
  '/admin/reports',
]

async function generateTestActivityData() {
  console.log('=== 테스트 활동 데이터 생성 시작 ===\n')

  // Supabase 클라이언트 생성
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    // 1. 활성 회원 목록 조회
    console.log('1. 활성 회원 목록 조회 중...')
    const { data: members, error: membersError } = await supabase
      .from('member_profiles')
      .select('id, display_name, registration_status, is_active')
      .eq('registration_status', 'approved')
      .eq('is_active', true)

    if (membersError) {
      console.error('회원 조회 오류:', membersError)
      return
    }

    console.log(`활성 회원 수: ${members.length}명`)

    if (members.length === 0) {
      console.log('⚠️ 활성 회원이 없습니다. 먼저 회원을 승인해주세요.')
      return
    }

    // 2. 지난 30일간의 활동 데이터 생성
    console.log('\n2. 지난 30일간의 활동 데이터 생성 중...')

    const activities = []
    const now = new Date()
    const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30일 전

    // 각 회원별로 랜덤한 활동 생성
    for (const member of members) {
      const activityCount = Math.floor(Math.random() * 50) + 10 // 10-60개 활동

      for (let i = 0; i < activityCount; i++) {
        // 랜덤한 날짜 생성 (지난 30일 내)
        const randomDate = new Date(
          startDate.getTime() + Math.random() * (now.getTime() - startDate.getTime())
        )

        // 랜덤한 활동 유형
        const actionType = ACTIVITY_TYPES[Math.floor(Math.random() * ACTIVITY_TYPES.length)]

        // 활동별 메타데이터 생성
        let metadata = {
          generated: true,
          timestamp: randomDate.toISOString(),
        }
        let targetType = 'system'
        let targetId = null

        switch (actionType) {
          case 'page_viewed':
            metadata.path = PAGE_PATHS[Math.floor(Math.random() * PAGE_PATHS.length)]
            metadata.referrer = Math.random() > 0.5 ? 'direct' : 'https://google.com'
            break
          case 'post_created':
          case 'post_updated':
            targetType = 'post'
            // target_id는 null로 두고 메타데이터에 정보 저장
            metadata.post_reference = `post_${Math.floor(Math.random() * 1000)}`
            metadata.category = ['공지', '잡담', '홍보', '건의'][Math.floor(Math.random() * 4)]
            break
          case 'comment_created':
            targetType = 'comment'
            metadata.comment_reference = `comment_${Math.floor(Math.random() * 1000)}`
            metadata.post_reference = `post_${Math.floor(Math.random() * 1000)}`
            break
          case 'like_added':
          case 'like_removed':
            targetType = 'post'
            metadata.post_reference = `post_${Math.floor(Math.random() * 1000)}`
            break
          case 'search_performed':
            metadata.query = ['아티스트', '프로젝트', '전시', '공연'][Math.floor(Math.random() * 4)]
            metadata.results_count = Math.floor(Math.random() * 20)
            break
          case 'file_uploaded':
            targetType = 'file'
            metadata.file_reference = `file_${Math.floor(Math.random() * 1000)}`
            metadata.file_type = ['image', 'document', 'video'][Math.floor(Math.random() * 3)]
            break
        }

        activities.push({
          user_id: member.id,
          action_type: actionType,
          target_type: targetType,
          target_id: targetId,
          metadata,
          ip_address: `192.168.1.${Math.floor(Math.random() * 255)}`,
          user_agent: 'Generated Test Data',
          created_at: randomDate.toISOString(),
        })
      }
    }

    console.log(`생성할 총 활동 수: ${activities.length}개`)

    // 3. 배치로 데이터베이스에 삽입
    console.log('\n3. 데이터베이스에 활동 데이터 삽입 중...')

    const batchSize = 100
    let insertedCount = 0

    for (let i = 0; i < activities.length; i += batchSize) {
      const batch = activities.slice(i, i + batchSize)

      const { data, error } = await supabase.from('user_activities').insert(batch)

      if (error) {
        console.error(`배치 ${Math.floor(i / batchSize) + 1} 삽입 오류:`, error)
      } else {
        insertedCount += batch.length
        console.log(
          `진행률: ${insertedCount}/${activities.length} (${Math.round((insertedCount / activities.length) * 100)}%)`
        )
      }
    }

    // 4. 생성된 데이터 확인
    console.log('\n4. 생성된 데이터 확인 중...')

    const { data: recentActivities, error: checkError } = await supabase
      .from('user_activities')
      .select('action_type, created_at, metadata')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(10)

    if (checkError) {
      console.error('데이터 확인 오류:', checkError)
    } else {
      console.log('최근 생성된 활동들:')
      recentActivities.forEach(activity => {
        console.log(`- ${activity.action_type} at ${activity.created_at}`)
      })
    }

    // 5. 활동 유형별 통계
    const { data: activityStats } = await supabase
      .from('user_activities')
      .select('action_type')
      .gte('created_at', startDate.toISOString())

    if (activityStats) {
      const stats = activityStats.reduce((acc, activity) => {
        acc[activity.action_type] = (acc[activity.action_type] || 0) + 1
        return acc
      }, {})

      console.log('\n활동 유형별 통계:')
      Object.entries(stats).forEach(([type, count]) => {
        console.log(`- ${type}: ${count}개`)
      })
    }

    console.log('\n=== 테스트 데이터 생성 완료 ===')
    console.log(`총 ${insertedCount}개의 활동 데이터가 생성되었습니다.`)
    console.log('이제 리포트 생성을 테스트해보세요!')
  } catch (error) {
    console.error('테스트 데이터 생성 중 오류 발생:', error)
  }
}

generateTestActivityData()
