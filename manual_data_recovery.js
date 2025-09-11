/**
 * 수동 데이터 복구 스크립트
 * post_likes와 notifications 데이터를 기반으로
 * 실제 게시물들의 기본 정보를 추정하여 복구 시도
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

// 실제 게시물 통계 (real_post_ids_analysis.json에서 가져옴)
const analysisData = JSON.parse(fs.readFileSync('real_post_ids_analysis.json', 'utf8'))
const realPostStats = analysisData.real_post_stats

async function manualDataRecovery() {
  console.log('=== 수동 데이터 복구 시작 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    console.log(`1. 실제 게시물 ${Object.keys(realPostStats).length}개 수동 복구 시작`)

    // 1. 기본 사용자 정보 조회 (게시물 작성자로 사용할 기본 계정)
    const { data: users, error: usersError } = await supabase
      .from('member_profiles')
      .select('id, display_name, email')
      .eq('is_active', true)
      .limit(5)

    if (usersError) {
      console.error('❌ 사용자 조회 오류:', usersError.message)
      return
    }

    if (users.length === 0) {
      console.error('❌ 활성 사용자가 없습니다.')
      return
    }

    const defaultAuthor = users[0] // 첫 번째 활성 사용자를 기본 작성자로 사용
    console.log(`✅ 기본 작성자 설정: ${defaultAuthor.display_name} (${defaultAuthor.id})`)

    // 2. 각 실제 게시물에 대해 기본 정보로 복구 시도
    const recoveredPosts = []
    let successCount = 0
    let errorCount = 0

    console.log('\n2. 게시물 복구 진행:')

    for (const [postId, stats] of Object.entries(realPostStats)) {
      try {
        console.log(`\n처리 중: ${postId}`)
        console.log(`   좋아요 수: ${stats.like_count}`)
        console.log(`   첫 좋아요: ${stats.first_like_at}`)
        console.log(`   마지막 좋아요: ${stats.last_like_at}`)

        // 게시물 생성 시간을 첫 번째 좋아요보다 조금 이전으로 추정
        const estimatedCreatedAt = new Date(new Date(stats.first_like_at).getTime() - 5 * 60 * 1000) // 5분 전

        // 기본 게시물 데이터 생성 (필수 컬럼만 사용)
        const postData = {
          id: postId,
          title: `복구된 게시물 #${postId.slice(0, 8)}`,
          content: `이 게시물은 데이터 복구 과정에서 재생성되었습니다.\n\n원본 정보:\n- 좋아요 수: ${stats.like_count}개\n- 좋아요 사용자: ${stats.user_ids.length}명\n- 활동 기간: ${stats.first_like_at.split('T')[0]} ~ ${stats.last_like_at.split('T')[0]}\n\n복구 시점: ${new Date().toISOString()}`,
          author_id: defaultAuthor.id,
          created_at: estimatedCreatedAt.toISOString(),
          updated_at: estimatedCreatedAt.toISOString(),
          is_deleted: false,
          category: '잡담', // posts 테이블 기본 카테고리
        }

        // 게시물 삽입
        const { data: insertedPost, error: insertError } = await supabase
          .from('posts')
          .insert([postData])
          .select()
          .single()

        if (insertError) {
          console.error(`   ❌ 삽입 오류: ${insertError.message}`)
          errorCount++
        } else {
          console.log(`   ✅ 복구 완료: "${insertedPost.title}"`)
          recoveredPosts.push(insertedPost)
          successCount++
        }
      } catch (error) {
        console.error(`   ❌ 처리 오류: ${error.message}`)
        errorCount++
      }
    }

    // 3. 복구 결과 요약
    console.log('\n3. 복구 결과 요약')
    console.log(`✅ 성공: ${successCount}개`)
    console.log(`❌ 실패: ${errorCount}개`)
    console.log(
      `📊 성공률: ${Math.round((successCount / Object.keys(realPostStats).length) * 100)}%`
    )

    if (successCount > 0) {
      console.log('\n복구된 게시물 목록:')
      recoveredPosts.forEach((post, index) => {
        console.log(`${index + 1}. "${post.title}" (${post.created_at})`)
      })
    }

    // 4. post_likes 데이터 무결성 확인
    console.log('\n4. post_likes 데이터 무결성 확인')
    const { data: likesCheck, error: likesError } = await supabase
      .from('post_likes')
      .select('post_id')
      .in('post_id', Object.keys(realPostStats))

    if (likesError) {
      console.error('❌ post_likes 확인 오류:', likesError.message)
    } else {
      const validLikes = likesCheck.length
      const totalLikes = analysisData.summary.real_post_likes
      console.log(
        `✅ post_likes 무결성: ${validLikes}/${totalLikes} (${Math.round((validLikes / totalLikes) * 100)}%)`
      )
    }

    // 5. 복구 결과 저장
    const recoveryResult = {
      timestamp: new Date().toISOString(),
      summary: {
        total_target_posts: Object.keys(realPostStats).length,
        successfully_recovered: successCount,
        failed_recoveries: errorCount,
        success_rate: Math.round((successCount / Object.keys(realPostStats).length) * 100),
      },
      recovered_posts: recoveredPosts.map(p => ({
        id: p.id,
        title: p.title,
        created_at: p.created_at,
        category: p.category,
      })),
      data_integrity: {
        post_likes_valid: likesCheck?.length || 0,
        post_likes_total: analysisData.summary.real_post_likes,
      },
    }

    fs.writeFileSync('manual_recovery_results.json', JSON.stringify(recoveryResult, null, 2))
    console.log('\n✅ 복구 결과가 manual_recovery_results.json에 저장되었습니다.')

    // 6. 다음 단계 안내
    console.log('\n6. 다음 단계')
    if (successCount > 0) {
      console.log('🎯 성공적으로 복구된 게시물들이 있습니다!')
      console.log('📋 추가 작업:')
      console.log('   1. 웹사이트에서 복구된 게시물 확인')
      console.log('   2. post_likes 데이터와 실제 좋아요 수 일치 여부 확인')
      console.log('   3. 복구된 게시물 내용을 실제 내용으로 업데이트 (가능한 경우)')
      console.log('   4. 전체 시스템 기능 테스트')
    } else {
      console.log('❌ 수동 복구가 실패했습니다.')
      console.log('💡 대안:')
      console.log('   1. Supabase Point-in-Time Recovery 사용')
      console.log('   2. Supabase Support 팀에 백업 복원 요청')
    }
  } catch (error) {
    console.error('❌ 수동 복구 중 오류 발생:', error)
  }
}

manualDataRecovery()
