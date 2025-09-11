/**
 * Supabase Point-in-Time Recovery 가이드 및 백업 데이터 조회
 * 실제 원본 게시물 복구를 위한 백업 상황 확인
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

async function supabaseRecoveryGuide() {
  console.log('=== Supabase 실제 데이터 복구 가이드 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 프로젝트 정보 추출
  const projectRef = supabaseUrl.split('//')[1].split('.')[0]
  console.log(`📋 프로젝트 참조: ${projectRef}`)
  console.log(`🌐 프로젝트 URL: ${supabaseUrl}`)

  try {
    console.log('\n1. 현재 데이터베이스 상태 확인')

    // 현재 posts 상태
    const { data: currentPosts, error: postsError } = await supabase
      .from('posts')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })

    if (postsError) {
      console.error('❌ 현재 posts 조회 오류:', postsError.message)
    } else {
      console.log(`현재 posts 테이블: ${currentPosts.length}개 게시물`)
    }

    // post_likes 상태 확인
    const { data: currentLikes, error: likesError } = await supabase
      .from('post_likes')
      .select('post_id, created_at')
      .order('created_at', { ascending: true })

    if (likesError) {
      console.error('❌ post_likes 조회 오류:', likesError.message)
    } else {
      console.log(`보존된 post_likes: ${currentLikes.length}개`)

      if (currentLikes.length > 0) {
        const firstLike = currentLikes[0].created_at
        const lastLike = currentLikes[currentLikes.length - 1].created_at
        console.log(`좋아요 기간: ${firstLike.split('T')[0]} ~ ${lastLike.split('T')[0]}`)
      }
    }

    console.log('\n2. Point-in-Time Recovery 옵션')
    console.log('🎯 복구 목표 시점: 2025-09-09 (가짜 게시물 생성 이전)')
    console.log('')
    console.log('📋 Supabase 대시보드 접속 방법:')
    console.log(`   1. https://supabase.com/dashboard/project/${projectRef}`)
    console.log('   2. Settings → Database → Point in time recovery')
    console.log('   3. 2025-09-09 또는 그 이전 시점 선택')
    console.log('   4. 새로운 프로젝트로 복원 (권장)')
    console.log('')
    console.log('⚠️  주의사항:')
    console.log('   - Point-in-Time Recovery는 전체 데이터베이스를 복원합니다')
    console.log('   - 현재 데이터베이스의 모든 변경사항이 손실될 수 있습니다')
    console.log('   - 새 프로젝트로 복원 후 필요한 데이터만 마이그레이션 권장')

    console.log('\n3. 대안: SQL 백업을 통한 선택적 복구')
    console.log('💡 만약 Point-in-Time Recovery가 불가능하다면:')
    console.log('   1. Supabase Support에 2025-09-09 백업 데이터 요청')
    console.log('   2. posts 테이블 백업 SQL 파일 요청')
    console.log('   3. 수동으로 실제 게시물 데이터 복원')

    // 복구해야 할 게시물 ID 목록 출력
    const analysisData = JSON.parse(fs.readFileSync('real_post_ids_analysis.json', 'utf8'))
    console.log('\n4. 복구 대상 게시물 ID 목록')
    console.log(`📝 총 ${analysisData.real_post_ids.length}개 게시물 복구 필요:`)
    console.log('')
    analysisData.real_post_ids.forEach((id, index) => {
      const stats = analysisData.real_post_stats[id]
      console.log(`${index + 1}. ${id}`)
      console.log(
        `   좋아요: ${stats.like_count}개, 기간: ${stats.first_like_at.split('T')[0]} ~ ${stats.last_like_at.split('T')[0]}`
      )
    })

    console.log('\n5. 복구 성공 확인 방법')
    console.log('✅ 복구가 성공하면 다음을 확인하세요:')
    console.log('   1. 게시물 제목이 "복구된 게시물 #"가 아닌 실제 제목')
    console.log('   2. 게시물 내용이 실제 원본 내용')
    console.log('   3. 첨부파일이 있었다면 첨부파일 복구')
    console.log('   4. post_likes 데이터와 실제 좋아요 수 일치')

    console.log('\n6. 다음 단계')
    console.log('🚀 권장 진행 순서:')
    console.log('   1. Supabase 대시보드에서 Point-in-Time Recovery 시도')
    console.log('   2. 새 프로젝트로 복원 후 원본 게시물 확인')
    console.log('   3. 원본 게시물의 SQL 추출')
    console.log('   4. 현재 프로젝트에 원본 게시물 데이터 삽입')
    console.log('   5. post_likes 데이터 무결성 검증')
    console.log('')
    console.log('📞 도움이 필요하시면 Supabase Support 팀에 문의하세요!')
  } catch (error) {
    console.error('❌ 복구 가이드 실행 중 오류 발생:', error)
  }
}

supabaseRecoveryGuide()
