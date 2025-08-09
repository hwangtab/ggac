/**
 * 특정 게시글의 첨부파일 확인 스크립트
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDMwMDYzMywiZXhwIjoyMDY1ODc2NjMzfQ.Sr0IFXaNOPphT9wTPlXgEYxok9Fg-82YGYwOOzVDEQ4';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkAttachments() {
  try {
    const postId = '197df89f-1084-423a-a6c3-eedc18c55b71'; // "이미지 테스트" 게시글
    
    console.log(`🔍 게시글 ${postId}의 첨부파일 확인 중...\n`);

    // 1. 게시글 정보 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('title, content, author_id')
      .eq('id', postId)
      .single();

    if (postError) {
      console.error('❌ 게시글 조회 실패:', postError.message);
      return;
    }

    console.log('📄 게시글 정보:');
    console.log(`   제목: ${post.title}`);
    console.log(`   내용: ${post.content.substring(0, 100)}...`);
    console.log(`   작성자 ID: ${post.author_id}`);

    // 2. 첨부파일 확인
    console.log('\n📎 첨부파일 확인:');
    const { data: attachments, error: attachmentError } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .order('sort_order', { ascending: true });

    if (attachmentError) {
      console.error('❌ 첨부파일 조회 실패:', attachmentError.message);
      return;
    }

    if (!attachments || attachments.length === 0) {
      console.log('   📭 첨부파일이 없습니다.');
      
      console.log('\n🔧 문제 분석:');
      console.log('   1. 업로드 시 성공 메시지가 표시되었지만 실제로는 데이터베이스에 저장되지 않음');
      console.log('   2. Storage에는 파일이 업로드되었지만 메타데이터 저장 실패');
      console.log('   3. 또는 아직 첨부파일이 업로드되지 않음');
      
      // Storage에서 해당 게시글 폴더 확인
      console.log('\n📁 Storage 폴더 확인:');
      const { data: files, error: storageError } = await supabase.storage
        .from('attachments')
        .list(`posts/${postId}`, { limit: 100 });

      if (storageError) {
        console.log(`   ❌ Storage 조회 실패: ${storageError.message}`);
      } else if (!files || files.length === 0) {
        console.log('   📭 Storage에도 파일이 없습니다.');
      } else {
        console.log(`   📁 Storage에 ${files.length}개 파일 발견:`);
        files.forEach(file => {
          console.log(`      - ${file.name} (${file.metadata?.size || '크기 불명'})`);
        });
      }
    } else {
      console.log(`   📎 ${attachments.length}개 첨부파일 발견:`);
      attachments.forEach((attachment, index) => {
        console.log(`   ${index + 1}. ${attachment.file_name}`);
        console.log(`      타입: ${attachment.file_type} (${attachment.mime_type})`);
        console.log(`      크기: ${(attachment.file_size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`      URL: ${attachment.file_url}`);
        console.log(`      대체 텍스트: ${attachment.alt_text || '없음'}`);
        console.log(`      대표 이미지: ${attachment.is_primary ? '예' : '아니오'}`);
        console.log();
      });
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  }
}

checkAttachments();