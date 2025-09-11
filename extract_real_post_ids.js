/**
 * post_likes 테이블에서 실제 게시물 ID 추출 스크립트
 * 가짜 테스트 게시물 ID를 제외한 진짜 게시물 ID들을 찾아서 복구에 사용
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

// 현재 가짜 게시물 ID들 (2025-09-10 생성)
const FAKE_POST_IDS = [
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068', // 시스템 개선 건의
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a', // 안녕하세요! 경기아트콜렉티브입니다
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598', // 첫 번째 게시글입니다
  '262b02d7-0137-4538-9d7f-c937c050e8c9', // 작품 홍보 테스트
]

async function extractRealPostIds() {
  console.log('=== 실제 게시물 ID 추출 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    console.log('필요한 환경 변수:')
    console.log('- NEXT_PUBLIC_SUPABASE_URL')
    console.log('- SUPABASE_SERVICE_ROLE_KEY')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // 1. post_likes 테이블 전체 조회
    console.log('1. post_likes 테이블 전체 데이터 확인')
    const { data: allLikes, error: likesError } = await supabase
      .from('post_likes')
      .select('*')
      .order('created_at', { ascending: true })

    if (likesError) {
      console.error('❌ post_likes 조회 오류:', likesError.message)
      return
    }

    console.log(`✅ 전체 post_likes 개수: ${allLikes.length}개`)
    if (allLikes.length === 0) {
      console.log('❌ post_likes 테이블에 데이터가 없습니다!')
      return
    }

    // 2. 가짜 게시물 ID들의 좋아요 확인
    console.log('\n2. 가짜 게시물들의 좋아요 확인')
    const fakeLikes = allLikes.filter(like => FAKE_POST_IDS.includes(like.post_id))
    console.log(`가짜 게시물 좋아요 개수: ${fakeLikes.length}개`)

    FAKE_POST_IDS.forEach(fakeId => {
      const count = fakeLikes.filter(like => like.post_id === fakeId).length
      console.log(`  - ${fakeId}: ${count}개`)
    })

    // 3. 실제 게시물 ID들 추출
    console.log('\n3. 실제 게시물 ID들 추출')
    const realLikes = allLikes.filter(like => !FAKE_POST_IDS.includes(like.post_id))
    console.log(`실제 게시물 좋아요 개수: ${realLikes.length}개`)

    // 4. 실제 게시물 ID별 좋아요 수 집계
    const realPostStats = {}
    realLikes.forEach(like => {
      if (!realPostStats[like.post_id]) {
        realPostStats[like.post_id] = {
          post_id: like.post_id,
          like_count: 0,
          first_like_at: like.created_at,
          last_like_at: like.created_at,
          user_ids: [],
        }
      }
      realPostStats[like.post_id].like_count++
      realPostStats[like.post_id].user_ids.push(like.user_id)
      if (like.created_at < realPostStats[like.post_id].first_like_at) {
        realPostStats[like.post_id].first_like_at = like.created_at
      }
      if (like.created_at > realPostStats[like.post_id].last_like_at) {
        realPostStats[like.post_id].last_like_at = like.created_at
      }
    })

    const realPostIds = Object.keys(realPostStats)
    console.log(`실제 게시물 ID 개수: ${realPostIds.length}개`)

    if (realPostIds.length > 0) {
      console.log('\n실제 게시물 ID 목록 (좋아요 수 순):')
      const sortedStats = Object.values(realPostStats).sort((a, b) => b.like_count - a.like_count)

      sortedStats.forEach((stat, index) => {
        console.log(`${index + 1}. ${stat.post_id}`)
        console.log(`   좋아요: ${stat.like_count}개`)
        console.log(`   기간: ${stat.first_like_at} ~ ${stat.last_like_at}`)
        console.log(`   사용자: ${stat.user_ids.length}명`)
        console.log('')
      })
    }

    // 5. notifications 테이블에서 추가 정보 확인
    console.log('5. notifications 테이블에서 관련 정보 확인')
    const { data: notifications, error: notifError } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: true })

    if (notifError) {
      console.error('❌ notifications 조회 오류:', notifError.message)
    } else {
      console.log(`✅ 전체 notifications 개수: ${notifications.length}개`)

      const notificationsWithPostId = notifications.filter(n => n.related_post_id !== null)
      const notificationsWithoutPostId = notifications.filter(n => n.related_post_id === null)

      console.log(`   - related_post_id가 있는 알림: ${notificationsWithPostId.length}개`)
      console.log(`   - related_post_id가 null인 알림: ${notificationsWithoutPostId.length}개`)

      if (notificationsWithPostId.length > 0) {
        console.log('\n   관련 게시물이 있는 알림들의 post_id:')
        const notifPostIds = [...new Set(notificationsWithPostId.map(n => n.related_post_id))]
        notifPostIds.forEach(id => {
          const count = notificationsWithPostId.filter(n => n.related_post_id === id).length
          console.log(`     - ${id}: ${count}개 알림`)
        })
      }
    }

    // 6. 결과를 파일로 저장
    console.log('\n6. 결과 저장')
    const result = {
      timestamp: new Date().toISOString(),
      summary: {
        total_likes: allLikes.length,
        fake_post_likes: fakeLikes.length,
        real_post_likes: realLikes.length,
        real_post_count: realPostIds.length,
      },
      fake_post_ids: FAKE_POST_IDS,
      real_post_stats: realPostStats,
      real_post_ids: realPostIds,
    }

    fs.writeFileSync('real_post_ids_analysis.json', JSON.stringify(result, null, 2))
    console.log('✅ 분석 결과가 real_post_ids_analysis.json에 저장되었습니다.')

    // 7. 복구 가능성 평가
    console.log('\n7. 복구 가능성 평가')
    if (realPostIds.length > 0) {
      console.log(`🎯 복구 대상: ${realPostIds.length}개의 실제 게시물 ID 발견`)
      console.log('📋 다음 단계:')
      console.log('   1. Supabase 대시보드에서 9월 10일 이전 백업 확인')
      console.log('   2. 해당 백업에서 이 ID들의 posts 데이터 추출')
      console.log('   3. 가짜 게시물 삭제 후 실제 데이터 복원')
      console.log('   4. post_likes 및 notifications 데이터 무결성 복구')
    } else {
      console.log('❌ 실제 게시물 ID를 찾을 수 없습니다.')
      console.log('💡 추가 조사 필요: 백업 데이터나 다른 관련 테이블 확인')
    }
  } catch (error) {
    console.error('❌ 스크립트 실행 중 오류 발생:', error)
  }
}

extractRealPostIds()
