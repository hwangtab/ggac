/**
 * 모든 가짜 게시물 삭제 스크립트
 * 현재 posts 테이블의 모든 가짜 데이터를 완전히 삭제
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

async function deleteAllFakePosts() {
  console.log('=== 모든 가짜 게시물 삭제 시작 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    console.log('🔍 1. 현재 posts 테이블 상태 확인')
    const { data: currentPosts, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })

    if (postsError) {
      console.error('❌ posts 조회 오류:', postsError.message)
      return
    }

    console.log(`현재 posts 테이블에 ${currentPosts.length}개 게시물 존재`)

    if (currentPosts.length === 0) {
      console.log('✅ 삭제할 게시물이 없습니다.')
      return
    }

    currentPosts.forEach((post, index) => {
      console.log(`${index + 1}. "${post.title}" (ID: ${post.id})`)
      console.log(`   작성일: ${post.created_at}`)
      console.log(`   내용 길이: ${post.content?.length || 0}자`)
    })

    console.log('\n🗑️ 2. 관련 데이터 삭제 (외래키 제약 조건 해결)')

    const postIds = currentPosts.map(post => post.id)

    // 2-1. comments 삭제
    console.log('2-1. comments 삭제 중...')
    const { error: commentsDeleteError } = await supabase
      .from('comments')
      .delete()
      .in('post_id', postIds)

    if (commentsDeleteError) {
      console.log('⚠️ comments 삭제 중 오류:', commentsDeleteError.message)
    } else {
      console.log('✅ comments 삭제 완료')
    }

    // 2-2. post_attachments 삭제
    console.log('2-2. post_attachments 삭제 중...')
    const { error: attachmentsDeleteError } = await supabase
      .from('post_attachments')
      .delete()
      .in('post_id', postIds)

    if (attachmentsDeleteError) {
      console.log('⚠️ post_attachments 삭제 중 오류:', attachmentsDeleteError.message)
    } else {
      console.log('✅ post_attachments 삭제 완료')
    }

    // 2-3. notifications 삭제 (가짜 게시물 관련만)
    console.log('2-3. notifications 삭제 중...')
    const { error: notificationsDeleteError } = await supabase
      .from('notifications')
      .delete()
      .in('related_post_id', postIds)

    if (notificationsDeleteError) {
      console.log('⚠️ notifications 삭제 중 오류:', notificationsDeleteError.message)
    } else {
      console.log('✅ notifications 삭제 완료')
    }

    // ⚠️ 중요: post_likes는 삭제하지 않음 (실제 게시물 복구시 필요)
    console.log('⚠️ post_likes는 보존됩니다 (실제 게시물 복구시 재연결용)')

    console.log('\n🗑️ 3. posts 테이블 완전 삭제')
    const { error: postsDeleteError } = await supabase.from('posts').delete().in('id', postIds)

    if (postsDeleteError) {
      console.error('❌ posts 삭제 오류:', postsDeleteError.message)
      return
    }

    console.log('✅ 모든 가짜 게시물 삭제 완료')

    console.log('\n🔍 4. 삭제 결과 확인')
    const { data: remainingPosts, error: checkError } = await supabase.from('posts').select('*')

    if (checkError) {
      console.error('❌ 삭제 확인 중 오류:', checkError.message)
    } else {
      console.log(`현재 posts 테이블: ${remainingPosts.length}개 게시물`)
      if (remainingPosts.length === 0) {
        console.log('✅ posts 테이블이 완전히 정리되었습니다.')
      }
    }

    // 5. post_likes 데이터 보존 확인
    console.log('\n📊 5. 보존된 데이터 확인')
    const { data: preservedLikes, error: likesError } = await supabase
      .from('post_likes')
      .select('*')

    if (likesError) {
      console.error('❌ post_likes 확인 오류:', likesError.message)
    } else {
      console.log(`✅ post_likes 데이터 보존됨: ${preservedLikes.length}개`)
      console.log('이 데이터들은 실제 게시물 복구 후 자동으로 연결됩니다.')
    }

    // 삭제 결과 기록
    const deletionReport = {
      timestamp: new Date().toISOString(),
      deleted_posts: currentPosts.length,
      deleted_post_ids: postIds,
      preserved_likes: preservedLikes?.length || 0,
      status: 'completed',
      next_step: 'Contact Supabase Support for real post recovery',
    }

    fs.writeFileSync('fake_posts_deletion_report.json', JSON.stringify(deletionReport, null, 2))
    console.log('\n✅ 삭제 보고서가 fake_posts_deletion_report.json에 저장되었습니다.')

    console.log('\n🎯 다음 단계:')
    console.log('1. Supabase Support 팀에 실제 게시물 복구 요청')
    console.log('2. 복구된 실제 게시물과 post_likes 데이터 자동 연결')
    console.log('3. 정상적인 게시판 기능 복원')
  } catch (error) {
    console.error('❌ 가짜 게시물 삭제 중 오류 발생:', error)
  }
}

deleteAllFakePosts()
