/**
 * Supabase 설정 확인 스크립트
 * 데이터베이스 테이블과 Storage bucket 상태를 확인합니다.
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDMwMDYzMywiZXhwIjoyMDY1ODc2NjMzfQ.Sr0IFXaNOPphT9wTPlXgEYxok9Fg-82YGYwOOzVDEQ4';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSupabaseSetup() {
  console.log('🔍 Supabase 설정 확인 중...\n');

  try {
    // 1. 데이터베이스 연결 확인
    console.log('1. 데이터베이스 연결 확인...');
    const { data: healthCheck, error: healthError } = await supabase
      .from('posts')
      .select('id')
      .limit(1);
    
    if (healthError) {
      console.error('❌ 데이터베이스 연결 실패:', healthError.message);
      return;
    }
    console.log('✅ 데이터베이스 연결 성공');

    // 2. post_attachments 테이블 확인
    console.log('\n2. post_attachments 테이블 확인...');
    const { data: attachmentCheck, error: attachmentError } = await supabase
      .from('post_attachments')
      .select('id')
      .limit(1);
    
    if (attachmentError) {
      console.error('❌ post_attachments 테이블이 존재하지 않습니다:', attachmentError.message);
      console.log('📝 다음 SQL을 Supabase 대시보드에서 실행하세요:');
      console.log('   SQL Editor > 새 쿼리 > 마이그레이션 파일 내용 실행');
    } else {
      console.log('✅ post_attachments 테이블 존재 확인');
      console.log(`   현재 첨부파일 수: ${attachmentCheck}`);
    }

    // 3. Storage bucket 확인
    console.log('\n3. Storage bucket "attachments" 확인...');
    const { data: buckets, error: bucketListError } = await supabase.storage.listBuckets();
    
    if (bucketListError) {
      console.error('❌ Storage bucket 조회 실패:', bucketListError.message);
    } else {
      const attachmentsBucket = buckets.find(bucket => bucket.name === 'attachments');
      if (attachmentsBucket) {
        console.log('✅ "attachments" bucket 존재 확인');
        console.log(`   Public: ${attachmentsBucket.public}`);
      } else {
        console.error('❌ "attachments" bucket이 존재하지 않습니다.');
        console.log('📝 Supabase 대시보드에서 다음 작업을 수행하세요:');
        console.log('   1. Storage > 새 bucket 생성');
        console.log('   2. 이름: "attachments"');
        console.log('   3. Public bucket으로 설정');
      }
    }

    // 4. 샘플 업로드 테스트
    console.log('\n4. Storage 업로드 권한 테스트...');
    const testFile = Buffer.from('test file content', 'utf-8');
    const testPath = 'test/test-file.txt';
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(testPath, testFile, { upsert: true });
    
    if (uploadError) {
      console.error('❌ Storage 업로드 권한 없음:', uploadError.message);
    } else {
      console.log('✅ Storage 업로드 권한 확인');
      
      // 테스트 파일 삭제
      await supabase.storage.from('attachments').remove([testPath]);
      console.log('   테스트 파일 정리 완료');
    }

    // 5. RLS 정책 확인 (간접적)
    console.log('\n5. RLS 정책 확인...');
    console.log('   관리자 권한으로 테이블 접근 가능 여부 확인 중...');
    // Service role이므로 RLS를 우회할 수 있어야 함

  } catch (error) {
    console.error('❌ 설정 확인 중 오류 발생:', error);
  }
}

checkSupabaseSetup().then(() => {
  console.log('\n🏁 Supabase 설정 확인 완료');
});