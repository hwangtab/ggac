// 임시 파일: 회원 상태 분석을 위한 데이터베이스 쿼리 스크립트
// 실제 Supabase 데이터베이스에서 실행할 쿼리들

const memberAnalysisQueries = {
  // 1. registration_status별 회원 분포
  registrationStatusDistribution: `
    SELECT 
      registration_status,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
    FROM member_profiles 
    GROUP BY registration_status
    ORDER BY count DESC;
  `,

  // 2. registration_status='pending' 회원 수
  pendingMembers: `
    SELECT COUNT(*) as pending_count
    FROM member_profiles 
    WHERE registration_status = 'pending';
  `,

  // 3. registration_status='approved' 이면서 is_active=false 회원 수
  approvedButInactiveMembers: `
    SELECT COUNT(*) as approved_inactive_count
    FROM member_profiles 
    WHERE registration_status = 'approved' 
    AND is_active = false;
  `,

  // 4. 전체 상태 조합별 분포
  detailedStatusDistribution: `
    SELECT 
      registration_status,
      is_active,
      is_admin,
      is_suspended,
      COUNT(*) as count
    FROM member_profiles 
    GROUP BY registration_status, is_active, is_admin, is_suspended
    ORDER BY registration_status, is_active DESC, count DESC;
  `,

  // 5. 최근 가입한 회원들의 상태
  recentMembersStatus: `
    SELECT 
      id,
      display_name,
      email,
      registration_status,
      is_active,
      created_at,
      profile_completeness_score
    FROM member_profiles 
    ORDER BY created_at DESC 
    LIMIT 20;
  `,

  // 6. 관리자들의 상태
  adminStatus: `
    SELECT 
      id,
      display_name,
      email,
      registration_status,
      is_active,
      is_admin,
      created_at
    FROM member_profiles 
    WHERE is_admin = true
    ORDER BY created_at;
  `,

  // 7. 프로필 완성도별 분포
  profileCompletenessDistribution: `
    SELECT 
      CASE 
        WHEN profile_completeness_score >= 80 THEN '80-100%'
        WHEN profile_completeness_score >= 60 THEN '60-79%'
        WHEN profile_completeness_score >= 40 THEN '40-59%'
        WHEN profile_completeness_score >= 20 THEN '20-39%'
        ELSE '0-19%'
      END as completeness_range,
      COUNT(*) as count
    FROM member_profiles 
    GROUP BY 
      CASE 
        WHEN profile_completeness_score >= 80 THEN '80-100%'
        WHEN profile_completeness_score >= 60 THEN '60-79%'
        WHEN profile_completeness_score >= 40 THEN '40-59%'
        WHEN profile_completeness_score >= 20 THEN '20-39%'
        ELSE '0-19%'
      END
    ORDER BY 
      CASE 
        WHEN profile_completeness_score >= 80 THEN 1
        WHEN profile_completeness_score >= 60 THEN 2
        WHEN profile_completeness_score >= 40 THEN 3
        WHEN profile_completeness_score >= 20 THEN 4
        ELSE 5
      END;
  `,

  // 8. 문제가 될 수 있는 계정들 (승인되었지만 비활성화)
  problematicAccounts: `
    SELECT 
      id,
      display_name,
      email,
      registration_status,
      is_active,
      is_suspended,
      suspension_reason,
      created_at,
      updated_at,
      profile_completeness_score
    FROM member_profiles 
    WHERE 
      (registration_status = 'approved' AND is_active = false)
      OR (registration_status = 'pending' AND created_at < NOW() - INTERVAL '30 days')
      OR is_suspended = true
    ORDER BY created_at DESC;
  `
};

module.exports = memberAnalysisQueries;