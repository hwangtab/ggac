/**
 * 심층 포렌식 분석 스크립트
 * PostgreSQL과 Supabase 시스템 레벨에서 삭제된 게시물 데이터 복구 시도
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

// 복구 대상 게시물 ID들
const REAL_POST_IDS = [
  '7922037f-168b-4c1a-ab0b-8668d462ee9b',
  'e7fa6a8a-9569-48a2-b0d3-c29cd51a1e5e',
  '0e307867-f023-4598-a817-946f56724b67',
  'f8a8cff5-28c4-42ff-a016-ff893425d7da',
  '9f5883a9-b77a-4707-bb41-be77f597b2d7',
  '83fe0df7-e72e-4bc3-add4-cb42540ca68d',
  '3b805830-e546-4df8-8e8a-8166bd3c692f',
  'd0d87e22-1904-4a9a-94ad-7ebce328ba89',
  '445b051c-7c51-423b-bb31-5df48dcdd545',
  '301d9f12-3a5d-48b9-b1cd-891d4cc3caa6',
  '203d9082-6d46-45e1-ae21-a05847ace22d',
  '958268fd-7ab9-4774-a611-13a75e6b0cea',
  'b7b0a87e-a720-4ae0-8118-2b5191530e10',
  'b077baa7-d7a3-4480-a77f-18a9d9ae33d1',
  'e84ed6a1-bfdd-44bc-9b1a-8df043e61384',
  '112054ea-e759-4320-b28f-991b0ba58729',
  '6c3f7ba1-1102-4d83-8e84-6f6ac02f48d8',
]

async function deepForensicAnalysis() {
  console.log('=== 심층 포렌식 분석 시작 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const results = {
    timestamp: new Date().toISOString(),
    investigations: [],
    recovered_data: [],
    conclusions: [],
  }

  try {
    console.log('🔍 1. PostgreSQL 시스템 레벨 조사')
    console.log('==========================================')

    // 1-1. WAL 설정 확인
    console.log('\n1-1. WAL (Write-Ahead Log) 설정 조사')
    try {
      const { data: walSettings, error: walError } = await supabase.rpc('exec_sql', {
        query:
          "SELECT name, setting, context FROM pg_settings WHERE name LIKE '%wal%' OR name LIKE '%archive%' ORDER BY name;",
      })

      if (walError) {
        console.log('❌ WAL 설정 조회 실패:', walError.message)
        results.investigations.push({
          type: 'WAL Settings',
          status: 'failed',
          error: walError.message,
        })
      } else {
        console.log('✅ WAL 설정 조회 성공:', walSettings?.length || 0, '개 설정')
        results.investigations.push({
          type: 'WAL Settings',
          status: 'success',
          data: walSettings,
        })
      }
    } catch (error) {
      console.log('❌ WAL 설정 조회 오류:', error.message)
    }

    // 1-2. 데이터베이스 통계 확인
    console.log('\n1-2. 데이터베이스 활동 통계 조사')
    try {
      const { data: dbStats, error: dbStatsError } = await supabase
        .from('pg_stat_database')
        .select('*')
        .eq('datname', 'postgres')

      if (dbStatsError) {
        console.log('❌ DB 통계 조회 실패:', dbStatsError.message)
      } else {
        console.log('✅ DB 통계 조회 성공')
        if (dbStats && dbStats.length > 0) {
          const stats = dbStats[0]
          console.log(`   트랜잭션 수: ${stats.xact_commit + stats.xact_rollback}`)
          console.log(`   테이블 삽입: ${stats.tup_inserted}`)
          console.log(`   테이블 삭제: ${stats.tup_deleted}`)

          results.investigations.push({
            type: 'Database Statistics',
            status: 'success',
            data: stats,
          })
        }
      }
    } catch (error) {
      console.log('❌ DB 통계 조회 오류:', error.message)
    }

    console.log('\n🔍 2. Supabase 특화 시스템 조사')
    console.log('==========================================')

    // 2-1. 모든 스키마 조회
    console.log('\n2-1. 전체 스키마 및 테이블 조사')
    try {
      const { data: schemas, error: schemaError } = await supabase.rpc('exec_sql', {
        query: `
            SELECT schemaname, tablename, tableowner 
            FROM pg_tables 
            WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            ORDER BY schemaname, tablename;
          `,
      })

      if (schemaError) {
        console.log('❌ 스키마 조회 실패:', schemaError.message)
      } else {
        console.log('✅ 스키마 조회 성공:', schemas?.length || 0, '개 테이블')

        const supabaseSchemas =
          schemas?.filter(
            s =>
              s.schemaname.includes('supabase') ||
              s.schemaname.includes('backup') ||
              s.schemaname.includes('archive') ||
              s.tablename.includes('backup') ||
              s.tablename.includes('archive') ||
              s.tablename.includes('log')
          ) || []

        console.log('잠재적 백업/로그 테이블:', supabaseSchemas.length, '개')
        supabaseSchemas.forEach(table => {
          console.log(`   - ${table.schemaname}.${table.tablename}`)
        })

        results.investigations.push({
          type: 'Schema Analysis',
          status: 'success',
          potential_backup_tables: supabaseSchemas,
        })
      }
    } catch (error) {
      console.log('❌ 스키마 조회 오류:', error.message)
    }

    // 2-2. Supabase 마이그레이션 히스토리 분석
    console.log('\n2-2. Supabase 마이그레이션 히스토리 분석')
    try {
      const { data: migrations, error: migError } = await supabase
        .from('supabase_migrations.schema_migrations')
        .select('*')
        .order('inserted_at', { ascending: false })
        .limit(20)

      if (migError) {
        console.log('❌ 마이그레이션 히스토리 조회 실패:', migError.message)
      } else {
        console.log('✅ 마이그레이션 히스토리 조회 성공:', migrations?.length || 0, '개')

        // 9월 10일 이전 마이그레이션 확인
        const beforeSeptember10 =
          migrations?.filter(m => new Date(m.inserted_at) < new Date('2025-09-10')) || []

        console.log('9월 10일 이전 마이그레이션:', beforeSeptember10.length, '개')

        results.investigations.push({
          type: 'Migration History',
          status: 'success',
          before_deletion: beforeSeptember10,
        })
      }
    } catch (error) {
      console.log('❌ 마이그레이션 히스토리 조회 오류:', error.message)
    }

    console.log('\n🔍 3. 관련 테이블에서 메타데이터 수집')
    console.log('==========================================')

    // 3-1. notifications 테이블에서 게시물 정보 추출
    console.log('\n3-1. notifications 테이블 분석')
    try {
      const { data: notifications, error: notifError } = await supabase
        .from('notifications')
        .select('*')
        .in('related_post_id', REAL_POST_IDS)
        .order('created_at', { ascending: false })

      if (notifError) {
        console.log('❌ notifications 조회 실패:', notifError.message)
      } else {
        console.log('✅ notifications 조회 성공:', notifications?.length || 0, '개')

        if (notifications && notifications.length > 0) {
          console.log('발견된 알림들:')
          notifications.forEach(notif => {
            console.log(`   - ${notif.type}: "${notif.message}"`)
            console.log(`     게시물: ${notif.related_post_id}`)
            console.log(`     데이터: ${JSON.stringify(notif.data)}`)
            console.log('')
          })

          results.recovered_data.push({
            source: 'notifications',
            count: notifications.length,
            data: notifications,
          })
        }
      }
    } catch (error) {
      console.log('❌ notifications 조회 오류:', error.message)
    }

    // 3-2. comments 테이블에서 게시물 맥락 추출
    console.log('\n3-2. comments 테이블 분석')
    try {
      const { data: comments, error: commentsError } = await supabase
        .from('comments')
        .select('*')
        .in('post_id', REAL_POST_IDS)
        .order('created_at', { ascending: false })

      if (commentsError) {
        console.log('❌ comments 조회 실패:', commentsError.message)
      } else {
        console.log('✅ comments 조회 성공:', comments?.length || 0, '개')

        if (comments && comments.length > 0) {
          console.log('발견된 댓글들:')
          comments.forEach(comment => {
            console.log(`   - 게시물 ${comment.post_id}`)
            console.log(`     댓글: "${comment.content}"`)
            console.log(`     작성자: ${comment.author_id}`)
            console.log(`     작성일: ${comment.created_at}`)
            console.log('')
          })

          results.recovered_data.push({
            source: 'comments',
            count: comments.length,
            data: comments,
          })
        }
      }
    } catch (error) {
      console.log('❌ comments 조회 오류:', error.message)
    }

    // 3-3. post_attachments 테이블에서 첨부파일 정보 추출
    console.log('\n3-3. post_attachments 테이블 분석')
    try {
      const { data: attachments, error: attachError } = await supabase
        .from('post_attachments')
        .select('*')
        .in('post_id', REAL_POST_IDS)
        .order('created_at', { ascending: false })

      if (attachError) {
        console.log('❌ post_attachments 조회 실패:', attachError.message)
      } else {
        console.log('✅ post_attachments 조회 성공:', attachments?.length || 0, '개')

        if (attachments && attachments.length > 0) {
          console.log('발견된 첨부파일들:')
          attachments.forEach(att => {
            console.log(`   - 게시물 ${att.post_id}`)
            console.log(`     파일: ${att.file_name} (${att.file_type})`)
            console.log(`     크기: ${att.file_size} bytes`)
            console.log(`     URL: ${att.file_url}`)
            console.log('')
          })

          results.recovered_data.push({
            source: 'post_attachments',
            count: attachments.length,
            data: attachments,
          })
        }
      }
    } catch (error) {
      console.log('❌ post_attachments 조회 오류:', error.message)
    }

    console.log('\n🔍 4. 고급 시스템 테이블 조사')
    console.log('==========================================')

    // 4-1. pg_stat_user_tables에서 테이블 활동 이력 확인
    console.log('\n4-1. 테이블 활동 통계 분석')
    try {
      const { data: tableStats, error: tableStatsError } = await supabase
        .from('pg_stat_user_tables')
        .select('*')
        .eq('relname', 'posts')

      if (tableStatsError) {
        console.log('❌ 테이블 통계 조회 실패:', tableStatsError.message)
      } else {
        console.log('✅ posts 테이블 통계 조회 성공')
        if (tableStats && tableStats.length > 0) {
          const stats = tableStats[0]
          console.log(`   총 삽입: ${stats.n_tup_ins}`)
          console.log(`   총 업데이트: ${stats.n_tup_upd}`)
          console.log(`   총 삭제: ${stats.n_tup_del}`)
          console.log(`   현재 행 수: ${stats.n_live_tup}`)
          console.log(`   삭제된 행 수: ${stats.n_dead_tup}`)

          results.investigations.push({
            type: 'Table Statistics',
            status: 'success',
            posts_table_stats: stats,
          })
        }
      }
    } catch (error) {
      console.log('❌ 테이블 통계 조회 오류:', error.message)
    }

    console.log('\n📊 분석 결과 요약')
    console.log('==========================================')

    const totalRecoveredItems = results.recovered_data.reduce((sum, item) => sum + item.count, 0)

    if (totalRecoveredItems > 0) {
      console.log('🎯 발견된 데이터:')
      results.recovered_data.forEach(item => {
        console.log(`   - ${item.source}: ${item.count}개 항목`)
      })

      results.conclusions.push('관련 테이블에서 일부 메타데이터 발견됨')
    } else {
      console.log('❌ 복구 가능한 게시물 데이터를 찾을 수 없음')
      results.conclusions.push('관련 테이블에서도 게시물 내용 복구 불가능')
    }

    // 최종 권장사항
    console.log('\n💡 최종 권장사항')
    console.log('==========================================')

    if (totalRecoveredItems === 0) {
      console.log('1. Supabase Support 팀에 직접 문의')
      console.log('   - 이메일: support@supabase.io')
      console.log('   - 요청: 2025-09-09 이전 posts 테이블 백업 데이터')
      console.log('   - 프로젝트 ID: ' + supabaseUrl.split('//')[1].split('.')[0])
      console.log('')
      console.log('2. 무료 계정도 중요한 데이터 손실시 지원 가능성 있음')
      console.log('3. 실제 원본 게시물 복구는 Supabase의 백업 시스템에만 의존')

      results.conclusions.push('Supabase Support 문의가 유일한 해결책')
    } else {
      console.log('1. 발견된 메타데이터로 부분 복구 시도 가능')
      console.log('2. 완전한 복구를 위해서는 여전히 Supabase Support 필요')

      results.conclusions.push('부분 복구 가능하나 완전한 복구는 Support 의존')
    }

    // 결과 저장
    fs.writeFileSync('deep_forensic_results.json', JSON.stringify(results, null, 2))
    console.log('\n✅ 심층 분석 결과가 deep_forensic_results.json에 저장되었습니다.')
  } catch (error) {
    console.error('❌ 심층 포렌식 분석 중 오류 발생:', error)
    results.conclusions.push(`분석 중 오류 발생: ${error.message}`)
  }

  return results
}

deepForensicAnalysis()
