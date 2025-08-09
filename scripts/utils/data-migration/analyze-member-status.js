#!/usr/bin/env node

const http = require('http');

const SERVER_URL = 'http://localhost:3000';

// API 테스트 함수
async function apiCall(path, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(SERVER_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const result = {
            status: res.statusCode,
            data: body ? JSON.parse(body) : null
          };
          resolve(result);
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: body
          });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function analyzeMemberStatus() {
  console.log('📊 회원 상태 분석 시작...\n');

  try {
    // 1. 전체 회원 목록 조회 (필터 없음)
    console.log('1. 전체 회원 데이터 조회 중...');
    const allMembersResponse = await apiCall('/api/admin/members?filter=all&limit=100');
    
    if (allMembersResponse.status !== 401) {
      console.log(`⚠️  예상과 다른 응답: ${allMembersResponse.status}`);
      console.log('응답 데이터:', allMembersResponse.data);
      return;
    }

    console.log('✅ API 인증 확인됨 (401 응답)\n');

    // 2. 각 필터별 데이터 조회 시도
    const filters = ['all', 'pending', 'approved', 'rejected'];
    
    for (const filter of filters) {
      console.log(`2-${filter}. ${filter} 필터 데이터 조회...`);
      const response = await apiCall(`/api/admin/members?filter=${filter}&limit=100`);
      
      console.log(`  - 상태 코드: ${response.status}`);
      if (response.status === 401) {
        console.log('  - 인증 필요 (예상됨)');
      } else if (response.data && response.data.members) {
        console.log(`  - 회원 수: ${response.data.members.length}`);
        
        // 상태별 분석
        const members = response.data.members;
        const statusAnalysis = {
          pending: members.filter(m => m.registration_status === 'pending').length,
          approved_active: members.filter(m => m.registration_status === 'approved' && m.is_active).length,
          approved_inactive: members.filter(m => m.registration_status === 'approved' && !m.is_active).length,
          rejected: members.filter(m => m.registration_status === 'rejected').length,
          suspended: members.filter(m => m.is_suspended).length,
          artist: members.filter(m => m.is_artist).length,
          admin: members.filter(m => m.is_admin).length
        };
        
        console.log('  - 상태 분석:', statusAnalysis);
      } else {
        console.log('  - 데이터 없음 또는 오류');
      }
      console.log('');
    }

    // 3. 직접 데이터베이스 분석을 위한 Supabase 테스트
    console.log('3. 데이터베이스 분석을 위한 테스트 API 생성 제안...');
    console.log('   실제 데이터 분석을 위해서는 관리자 인증이 필요합니다.');
    console.log('   또는 Supabase 대시보드에서 직접 SQL 쿼리를 실행할 수 있습니다.\n');

    // 4. 분석용 SQL 쿼리 제안
    console.log('4. 추천 분석 SQL 쿼리:');
    console.log(`
-- 전체 상태별 분포
SELECT 
  registration_status,
  is_active,
  is_suspended,
  COUNT(*) as count
FROM member_profiles 
GROUP BY registration_status, is_active, is_suspended
ORDER BY registration_status, is_active;

-- 승인 대기 회원
SELECT COUNT(*) as pending_count 
FROM member_profiles 
WHERE registration_status = 'pending';

-- 비활성화된 승인 회원
SELECT COUNT(*) as inactive_approved_count 
FROM member_profiles 
WHERE registration_status = 'approved' AND is_active = false;

-- 활성 승인 회원
SELECT COUNT(*) as active_approved_count 
FROM member_profiles 
WHERE registration_status = 'approved' AND is_active = true;

-- 정지된 회원
SELECT COUNT(*) as suspended_count 
FROM member_profiles 
WHERE is_suspended = true;
    `);

    console.log('\n🎯 분석 완료!');
    console.log('다음 단계: Supabase 대시보드에서 위 SQL 쿼리들을 실행하여 정확한 데이터를 확인하세요.');

  } catch (error) {
    console.error('❌ 분석 중 오류 발생:', error.message);
  }
}

// 스크립트 실행
if (require.main === module) {
  analyzeMemberStatus().catch(console.error);
}

module.exports = { analyzeMemberStatus };