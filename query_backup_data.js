/**
 * 백업 데이터에서 실제 게시물 복구 시도 스크립트
 * post_likes에서 찾은 17개 실제 게시물 ID로 백업 데이터 조회
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

// 실제 게시물 ID들 (post_likes에서 추출한 17개)
const REAL_POST_IDS = [
  '7922037f-168b-4c1a-ab0b-8668d462ee9b',
  'e7fa6a8a-9569-48a2-b0d3-c29cd51a1e5e',
  '0e307867-f023-4598-a817-946f56724b67',
  'f8a8cff5-28c4-42ff-a016-ff893425d7da',
  '9f5883a9-b77a-4707-bb41-be77f597b2d7',
  '83fe0df7-e72e-4bc3-add4-cb42540ca68d',
  '3b805830-e546-4df8-8e8a-8166bd3c692f',
  'd0d87e22-1904-4a9a-94ad-7ebce328ba89',
  '445b051c-7c51-423b-bb31-5df48dcdd545',
  '301d9f12-3a5d-48b9-b1cd-891d4cc3caa6',
  '203d9082-6d46-45e1-ae21-a05847ace22d',
  '958268fd-7ab9-4774-a611-13a75e6b0cea',
  'b7b0a87e-a720-4ae0-8118-2b5191530e10',
  'b077baa7-d7a3-4480-a77f-18a9d9ae33d1',
  'e84ed6a1-bfdd-44bc-9b1a-8df043e61384',
  '112054ea-e759-4320-b28f-991b0ba58729',
  '6c3f7ba1-1102-4d83-8e84-6f6ac02f48d8',
]

async function queryBackupData() {
  console.log('=== 백업 데이터에서 실제 게시물 조회 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    console.log(`1. 실제 게시물 ID ${REAL_POST_IDS.length}개로 백업 데이터 조회 시도`)

    // 1. 현재 posts 테이블에서 실제 게시물들이 있는지 확인 (soft delete 가능성)
    console.log('\n1-1. 현재 posts 테이블에서 soft delete 확인')
    const { data: postsWithDeleted, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .in('id', REAL_POST_IDS)
      .order('created_at', { ascending: false })

    if (postsError) {
      console.error('❌ posts 조회 오류:', postsError.message)
    } else {
      console.log(`✅ 현재 posts 테이블에서 찾은 게시물: ${postsWithDeleted.length}개`)

      if (postsWithDeleted.length > 0) {
        console.log('발견된 게시물들:')
        postsWithDeleted.forEach(post => {
          console.log(`  - "${post.title}" (${post.created_at}) - deleted: ${post.is_deleted}`)
        })
      } else {
        console.log('현재 posts 테이블에서는 실제 게시물을 찾을 수 없습니다.')
      }
    }

    // 2. activity_logs 테이블이 있다면 게시물 생성/삭제 로그 확인
    console.log('\n1-2. activity_logs 테이블에서 게시물 관련 활동 확인')
    const { data: activityLogs, error: activityError } = await supabase
      .from('activity_logs')
      .select('*')
      .contains('details', { post_id: REAL_POST_IDS[0] })
      .limit(10)

    if (activityError) {
      console.log('activity_logs 테이블이 없거나 접근할 수 없습니다.')
    } else {
      console.log(`activity_logs에서 관련 활동 ${activityLogs.length}개 발견`)
    }

    // 3. 관련 테이블들에서 데이터 무결성 확인
    console.log('\n2. 관련 테이블들에서 참조 무결성 확인')

    // 3-1. post_likes 재확인
    const { data: likesCheck, error: likesError } = await supabase
      .from('post_likes')
      .select('post_id, user_id, created_at')
      .in('post_id', REAL_POST_IDS.slice(0, 5)) // 처음 5개만 확인

    if (likesError) {
      console.error('❌ post_likes 재확인 오류:', likesError.message)
    } else {
      console.log(`✅ post_likes에서 실제 게시물 좋아요 ${likesCheck.length}개 확인`)
    }

    // 3-2. notifications 테이블에서 관련 알림 확인
    const { data: notifCheck, error: notifError } = await supabase
      .from('notifications')
      .select('id, type, message, related_post_id, created_at')
      .in('related_post_id', REAL_POST_IDS.slice(0, 5))

    if (notifError) {
      console.error('❌ notifications 확인 오류:', notifError.message)
    } else {
      console.log(`✅ notifications에서 실제 게시물 알림 ${notifCheck.length}개 확인`)
      if (notifCheck.length > 0) {
        console.log('관련 알림들:')
        notifCheck.forEach(notif => {
          console.log(`  - ${notif.type}: "${notif.message}" (${notif.created_at})`)
        })
      }
    }

    // 4. 수동 복구 가능성 검토
    console.log('\n3. 수동 복구 가능성 검토')

    if (postsWithDeleted.length === 0) {
      console.log('🔍 현재 상황 분석:')
      console.log('   - posts 테이블에서 실제 게시물들이 완전히 삭제됨')
      console.log('   - post_likes와 notifications에는 참조가 남아있음')
      console.log('   - 이는 hard delete가 발생했음을 의미')

      console.log('\n💡 복구 방법:')
      console.log('   1. Supabase 대시보드에서 Point-in-Time Recovery 사용')
      console.log('   2. 9월 9일 또는 그 이전 시점으로 복원')
      console.log('   3. 또는 Supabase Support에 백업 데이터 요청')
      console.log('')
      console.log('🚨 주의사항:')
      console.log('   - Point-in-Time Recovery는 전체 데이터베이스를 복원함')
      console.log('   - 현재까지의 모든 변경사항이 손실될 수 있음')
      console.log('   - 백업 생성 후 진행 권장')
    } else {
      console.log('✅ 일부 게시물이 발견되어 복구 가능성이 있습니다.')
    }

    // 5. 결과 저장
    const result = {
      timestamp: new Date().toISOString(),
      query_results: {
        posts_found: postsWithDeleted.length,
        posts_data: postsWithDeleted,
        likes_verified: likesCheck?.length || 0,
        notifications_found: notifCheck?.length || 0,
      },
      recommendations:
        postsWithDeleted.length === 0
          ? [
              'Use Supabase Point-in-Time Recovery',
              'Contact Supabase Support for backup assistance',
              'Consider manual data reconstruction from related tables',
            ]
          : ['Restore found posts', 'Verify data integrity', 'Test functionality'],
    }

    fs.writeFileSync('backup_query_results.json', JSON.stringify(result, null, 2))
    console.log('\n✅ 조회 결과가 backup_query_results.json에 저장되었습니다.')
  } catch (error) {
    console.error('❌ 백업 데이터 조회 중 오류 발생:', error)
  }
}

queryBackupData()
