/**
 * 실제 게시글 ID를 조회하는 스크립트
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDMwMDYzMywiZXhwIjoyMDY1ODc2NjMzfQ.Sr0IFXaNOPphT9wTPlXgEYxok9Fg-82YGYwOOzVDEQ4';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function getPostId() {
  try {
    console.log('📋 게시글 목록 조회 중...\n');

    const { data: posts, error } = await supabase
      .from('posts')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('❌ 게시글 조회 실패:', error.message);
      return;
    }

    if (!posts || posts.length === 0) {
      console.log('📭 게시글이 없습니다.');
      return;
    }

    console.log('📄 최근 게시글 목록:');
    posts.forEach((post, index) => {
      console.log(`${index + 1}. ${post.title}`);
      console.log(`   ID: ${post.id}`);
      console.log(`   작성일: ${new Date(post.created_at).toLocaleString('ko-KR')}`);
      console.log();
    });

    // 첫 번째 게시글 ID로 API 테스트
    if (posts.length > 0) {
      const testPostId = posts[0].id;
      console.log(`🧪 첫 번째 게시글로 API 테스트: ${testPostId}`);
      
      // cURL 명령어 출력
      console.log('\n📋 테스트 명령어:');
      console.log(`curl -X GET "https://ggac.kr/api/posts/${testPostId}/attachments" -H "Accept: application/json"`);
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  }
}

getPostId();