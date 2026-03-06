/**
 * 게시글/댓글 데이터 조사 스크립트
 * 왜 posts 관련 통계가 0으로 나오는지 확인
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

async function investigatePostsData() {
  console.log('=== 게시글/댓글 데이터 조사 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // 1. 전체 게시글 수 확인
    console.log('1. 전체 게시글 현황')
    const { data: allPosts, error: postsError } = await supabase
      .from('posts')
      .select('id, title, created_at, views, likes, author_id')
      .order('created_at', { ascending: false })

    if (postsError) {
      console.error('❌ 게시글 조회 오류:', postsError.message)
    } else {
      console.log(`✅ 전체 게시글 수: ${allPosts.length}개`)
      if (allPosts.length > 0) {
        console.log('최근 게시글:')
        allPosts.slice(0, 5).forEach(post => {
          console.log(`  - "${post.title}" (${post.created_at})`)
        })
      }
    }

    // 2. 최근 30일 게시글 확인
    console.log('\n2. 최근 30일 게시글 확인')
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = new Date()

    const { data: recentPosts, error: recentError } = await supabase
      .from('posts')
      .select('id, title, created_at, views, likes')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false })

    if (recentError) {
      console.error('❌ 최근 게시글 조회 오류:', recentError.message)
    } else {
      console.log(`✅ 최근 30일 게시글: ${recentPosts.length}개`)
      console.log(
        `   조회 기간: ${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`
      )

      if (recentPosts.length > 0) {
        const totalViews = recentPosts.reduce((sum, post) => sum + (post.views || 0), 0)
        const totalLikes = recentPosts.reduce((sum, post) => sum + (post.likes || 0), 0)
        console.log(`   총 조회수: ${totalViews}`)
        console.log(`   총 좋아요: ${totalLikes}`)
      } else {
        console.log('   📝 최근 30일 동안 작성된 게시글이 없습니다.')
      }
    }

    // 3. 전체 댓글 수 확인
    console.log('\n3. 전체 댓글 현황')
    const { data: allComments, error: commentsError } = await supabase
      .from('comments')
      .select('id, post_id, created_at, author_id')
      .order('created_at', { ascending: false })

    if (commentsError) {
      console.error('❌ 댓글 조회 오류:', commentsError.message)
    } else {
      console.log(`✅ 전체 댓글 수: ${allComments.length}개`)
      if (allComments.length > 0) {
        console.log('최근 댓글:')
        allComments.slice(0, 3).forEach(comment => {
          console.log(`  - 게시글 ${comment.post_id}에 댓글 (${comment.created_at})`)
        })
      }
    }

    // 4. 최근 30일 댓글 확인
    console.log('\n4. 최근 30일 댓글 확인')
    const { data: recentComments, error: recentCommentsError } = await supabase
      .from('comments')
      .select('id, post_id, created_at')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false })

    if (recentCommentsError) {
      console.error('❌ 최근 댓글 조회 오류:', recentCommentsError.message)
    } else {
      console.log(`✅ 최근 30일 댓글: ${recentComments.length}개`)
      if (recentComments.length === 0) {
        console.log('   💬 최근 30일 동안 작성된 댓글이 없습니다.')
      }
    }

    // 5. 전체 기간 통계 (대안 데이터)
    console.log('\n5. 전체 기간 통계 (리포트 대안 데이터)')
    if (allPosts.length > 0) {
      const totalViews = allPosts.reduce((sum, post) => sum + (post.views || 0), 0)
      const totalLikes = allPosts.reduce((sum, post) => sum + (post.likes || 0), 0)

      console.log('전체 기간 통계:')
      console.log(`  - 총 게시글: ${allPosts.length}개`)
      console.log(`  - 총 댓글: ${allComments.length}개`)
      console.log(`  - 총 조회수: ${totalViews}`)
      console.log(`  - 총 좋아요: ${totalLikes}`)
      console.log(
        `  - 평균 참여도: ${allPosts.length > 0 ? Math.round(((allComments.length + totalLikes) / allPosts.length) * 100) / 100 : 0}`
      )
    }

    // 6. 결론 및 권장사항
    console.log('\n6. 분석 결과')
    if (recentPosts.length === 0 && recentComments.length === 0) {
      console.log('🔍 문제 원인: 최근 30일 동안 새로 작성된 게시글/댓글이 없음')
      console.log('💡 해결 방안:')
      console.log('   1. 전체 기간 통계를 기본으로 표시')
      console.log('   2. 기간 필터링을 선택적으로 적용')
      console.log('   3. "해당 기간 내 데이터 없음" 메시지 표시')
    } else {
      console.log('✅ 최근 데이터가 존재하므로 다른 원인 조사 필요')
    }
  } catch (error) {
    console.error('조사 중 오류 발생:', error)
  }
}

investigatePostsData()
