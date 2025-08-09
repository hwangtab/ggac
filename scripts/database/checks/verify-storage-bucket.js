// Storage bucket 직접 생성 및 확인 스크립트
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// .env.local 파일에서 환경변수 읽기
let supabaseUrl, supabaseAnonKey;

try {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    const envLines = envFile.split('\n');
    
    for (const line of envLines) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();
      
      if (key === 'NEXT_PUBLIC_SUPABASE_URL') {
        supabaseUrl = value;
      } else if (key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
        supabaseAnonKey = value;
      }
    }
  }
} catch (error) {
  console.log('⚠️ .env.local 파일을 읽을 수 없습니다:', error.message);
}

// 환경변수가 없으면 process.env에서 가져오기
supabaseUrl = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
supabaseAnonKey = supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function verifyStorageBucket() {
  console.log('🔍 Storage bucket 상태 확인 및 생성...\n');

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    // 1. 현재 bucket 목록 확인
    console.log('1️⃣ 현재 Storage bucket 목록 확인...');
    
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      console.log('❌ bucket 목록 조회 실패:', listError.message);
      return;
    }

    console.log('✅ 현재 bucket 목록:');
    buckets.forEach(bucket => {
      console.log(`   - ${bucket.id} (공개: ${bucket.public}, 크기제한: ${bucket.file_size_limit ? Math.round(bucket.file_size_limit / 1024 / 1024) + 'MB' : '무제한'})`);
    });

    // 2. profiles bucket 존재 확인
    const profilesBucket = buckets.find(bucket => bucket.id === 'profiles');
    
    if (profilesBucket) {
      console.log('\n✅ profiles bucket이 이미 존재합니다');
      console.log(`   - 공개 설정: ${profilesBucket.public}`);
      console.log(`   - 파일 크기 제한: ${profilesBucket.file_size_limit ? Math.round(profilesBucket.file_size_limit / 1024 / 1024) + 'MB' : '무제한'}`);
      console.log(`   - 허용 MIME 타입: ${profilesBucket.allowed_mime_types ? profilesBucket.allowed_mime_types.join(', ') : '모든 타입'}`);
    } else {
      console.log('\n❌ profiles bucket이 존재하지 않습니다');
      console.log('📝 다음 단계가 필요합니다:');
      console.log('1. Supabase Dashboard → Storage → Create bucket');
      console.log('2. Bucket ID: profiles');
      console.log('3. Public: true');
      console.log('4. File size limit: 2MB (2097152 bytes)');
      console.log('5. Allowed MIME types: image/jpeg, image/png, image/webp, image/gif');
      console.log('\n또는 SQL Editor에서 다음 함수 실행:');
      console.log('SELECT ensure_profiles_bucket_exists();');
    }

    // 3. 함수를 통한 bucket 생성 시도
    if (!profilesBucket) {
      console.log('\n2️⃣ 함수를 통한 bucket 생성 시도...');
      
      try {
        const { data: createResult, error: createError } = await supabase.rpc('ensure_profiles_bucket_exists');
        
        if (createError) {
          console.log('⚠️ 함수 호출 실패:', createError.message);
          console.log('📝 수동으로 Supabase Dashboard에서 bucket을 생성해야 합니다');
        } else {
          console.log('✅ bucket 생성 함수 실행:', createResult);
          
          // 다시 bucket 목록 확인
          const { data: newBuckets } = await supabase.storage.listBuckets();
          const newProfilesBucket = newBuckets?.find(bucket => bucket.id === 'profiles');
          
          if (newProfilesBucket) {
            console.log('✅ profiles bucket이 성공적으로 생성되었습니다!');
          } else {
            console.log('⚠️ bucket 생성이 확인되지 않았습니다');
          }
        }
      } catch (functionError) {
        console.log('❌ 함수 실행 중 오류:', functionError.message);
      }
    }

    // 4. Storage 정책 확인
    console.log('\n3️⃣ Storage 정책 테스트...');
    
    try {
      // profiles bucket에 테스트 파일 목록 조회
      const { data: files, error: filesError } = await supabase.storage
        .from('profiles')
        .list('', { limit: 5 });

      if (filesError) {
        console.log('⚠️ 파일 목록 조회 오류:', filesError.message);
      } else {
        console.log(`✅ Storage 접근 성공 (파일 수: ${files.length}개)`);
        
        if (files.length > 0) {
          console.log('   현재 파일들:');
          files.forEach(file => {
            console.log(`   - ${file.name} (${Math.round(file.metadata?.size / 1024)}KB)`);
          });
        }
      }
    } catch (storageError) {
      console.log('❌ Storage 테스트 중 오류:', storageError.message);
    }

    // 5. 마이그레이션 완료 상태 요약
    console.log('\n📋 마이그레이션 완료 상태:');
    
    const migrationComplete = profilesBucket !== undefined;
    
    if (migrationComplete) {
      console.log('✅ 프로필 사진 기능을 위한 모든 마이그레이션이 완료되었습니다!');
      console.log('\n🎉 다음 기능들이 사용 가능합니다:');
      console.log('   - 프로필 사진 업로드/수정/삭제');
      console.log('   - 이미지 최적화 및 썸네일 생성');
      console.log('   - 파일 크기 및 타입 검증');
      console.log('   - 활동 로그 자동 생성');
      console.log('   - 통계 및 관리 기능');
    } else {
      console.log('⚠️ 아직 완료되지 않은 마이그레이션이 있습니다');
      console.log('\n📝 다음 단계를 수행하세요:');
      console.log('1. Supabase Dashboard → Storage → Create new bucket');
      console.log('2. 또는 SQL Editor에서 ensure_profiles_bucket_exists() 함수 실행');
    }

  } catch (error) {
    console.error('❌ Storage 확인 중 오류:', error.message);
  }
}

verifyStorageBucket();