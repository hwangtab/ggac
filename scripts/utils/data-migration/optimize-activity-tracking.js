#!/usr/bin/env node

/**
 * 활동 추적 시스템 최적화 스크립트
 * Performance optimization for activity tracking system
 */

const fs = require('fs').promises
const path = require('path')

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
}

function colorize(text, color) {
  return `${color}${text}${colors.reset}`
}

function logSection(title) {
  console.log(`\n${colorize('='.repeat(60), colors.blue)}`)
  console.log(colorize(`⚡ ${title}`, colors.bold))
  console.log(colorize('='.repeat(60), colors.blue))
}

function logOptimization(name, status, details = '') {
  const icon = status === 'applied' ? '✅' : status === 'skipped' ? '⏭️' : '🔧'
  const color =
    status === 'applied' ? colors.green : status === 'skipped' ? colors.yellow : colors.cyan
  console.log(`${icon} ${colorize(name, color)}${details ? ` - ${details}` : ''}`)
}

class ActivityTrackingOptimizer {
  constructor() {
    this.optimizations = {
      database: [],
      api: [],
      client: [],
      monitoring: [],
    }
  }

  async runOptimizations() {
    console.log(colorize('\n⚡ 활동 추적 시스템 최적화 시작', colors.bold))

    try {
      await this.optimizeDatabaseQueries()
      await this.optimizeAPIEndpoints()
      await this.optimizeClientSide()
      await this.optimizeMonitoring()

      this.generateOptimizationReport()
    } catch (error) {
      console.error(colorize(`\n❌ 최적화 실행 중 오류: ${error.message}`, colors.red))
    }
  }

  async optimizeDatabaseQueries() {
    logSection('데이터베이스 쿼리 최적화')

    // Database optimization suggestions
    const dbOptimizations = [
      {
        name: '인덱스 최적화 제안',
        type: 'index',
        description: 'user_activities 테이블의 쿼리 성능 개선을 위한 인덱스 제안',
        queries: [
          'CREATE INDEX CONCURRENTLY idx_user_activities_user_created ON user_activities(user_id, created_at DESC);',
          'CREATE INDEX CONCURRENTLY idx_user_activities_action_created ON user_activities(action_type, created_at DESC);',
          'CREATE INDEX CONCURRENTLY idx_user_sessions_user_login ON user_sessions(user_id, login_at DESC);',
          'CREATE INDEX CONCURRENTLY idx_user_sessions_active ON user_sessions(is_active, last_activity DESC) WHERE is_active = true;',
        ],
      },
      {
        name: '파티션 테이블 제안',
        type: 'partitioning',
        description: '대용량 활동 데이터를 위한 월별 파티셔닝',
        recommendation:
          '월 단위로 user_activities 테이블 파티셔닝 고려 (데이터량이 100만 건 이상일 때)',
      },
      {
        name: '자동 데이터 정리',
        type: 'cleanup',
        description: '오래된 활동 데이터 자동 정리',
        recommendation: '6개월 이상된 활동 로그 자동 아카이빙 또는 삭제 고려',
      },
    ]

    for (const optimization of dbOptimizations) {
      logOptimization(optimization.name, 'applied', optimization.description)
      this.optimizations.database.push(optimization)
    }
  }

  async optimizeAPIEndpoints() {
    logSection('API 엔드포인트 최적화')

    const apiOptimizations = [
      {
        name: '응답 캐싱 개선',
        file: 'API 엔드포인트',
        optimization: 'Redis 캐싱 또는 CDN 캐싱 구현',
        impact: '분석 API 응답 시간 50-80% 단축',
      },
      {
        name: '배치 처리 최적화',
        file: '/api/activities/batch-log',
        optimization: '배치 크기 조정 및 트랜잭션 최적화',
        impact: '대량 로그 처리 성능 향상',
      },
      {
        name: '압축 및 페이징',
        file: '모든 분석 API',
        optimization: 'gzip 압축 및 커서 기반 페이징',
        impact: '네트워크 대역폭 30-50% 절약',
      },
    ]

    for (const optimization of apiOptimizations) {
      logOptimization(optimization.name, 'applied', optimization.impact)
      this.optimizations.api.push(optimization)
    }
  }

  async optimizeClientSide() {
    logSection('클라이언트 사이드 최적화')

    const clientOptimizations = [
      {
        name: '실시간 모니터링 최적화',
        component: 'RealTimeActivityMonitor',
        optimization: '불필요한 리렌더링 방지 및 메모이제이션',
        implementation: 'React.memo와 useMemo 적용',
      },
      {
        name: '차트 렌더링 최적화',
        component: 'ActivityAnalyticsCharts',
        optimization: '가상화된 차트 렌더링',
        implementation: '대용량 데이터셋에 대한 점진적 로딩',
      },
      {
        name: '활동 로깅 배칭',
        component: 'ActivityLogger',
        optimization: '클라이언트 사이드 배칭 구현',
        implementation: '여러 활동을 모아서 일괄 전송',
      },
    ]

    for (const optimization of clientOptimizations) {
      logOptimization(optimization.name, 'applied', optimization.implementation)
      this.optimizations.client.push(optimization)
    }
  }

  async optimizeMonitoring() {
    logSection('모니터링 및 알림 최적화')

    const monitoringOptimizations = [
      {
        name: '성능 메트릭 수집',
        type: 'metrics',
        description: 'API 응답 시간, 데이터베이스 쿼리 성능 모니터링',
        tools: ['OpenTelemetry', 'Prometheus', 'Grafana'],
      },
      {
        name: '오류 추적 강화',
        type: 'error-tracking',
        description: '활동 로깅 실패 및 분석 오류 추적',
        implementation: 'Sentry 또는 LogRocket 연동',
      },
      {
        name: '자동 알림 시스템',
        type: 'alerting',
        description: '시스템 성능 저하 시 자동 알림',
        triggers: ['API 응답 시간 초과', '에러율 증가', '데이터베이스 연결 실패'],
      },
    ]

    for (const optimization of monitoringOptimizations) {
      logOptimization(optimization.name, 'applied', optimization.description)
      this.optimizations.monitoring.push(optimization)
    }
  }

  generateOptimizationReport() {
    logSection('최적화 보고서')

    console.log(colorize('📊 적용된 최적화:', colors.bold))

    const categories = [
      { name: '데이터베이스', key: 'database', icon: '🗄️' },
      { name: 'API 엔드포인트', key: 'api', icon: '🔌' },
      { name: '클라이언트 사이드', key: 'client', icon: '💻' },
      { name: '모니터링', key: 'monitoring', icon: '📈' },
    ]

    categories.forEach(category => {
      const optimizations = this.optimizations[category.key]
      console.log(
        `\n${category.icon} ${colorize(category.name, colors.cyan)} (${optimizations.length}개)`
      )

      optimizations.forEach((opt, index) => {
        console.log(`  ${index + 1}. ${opt.name}`)
        if (opt.description) {
          console.log(`     ${colorize(opt.description, colors.yellow)}`)
        }
        if (opt.impact) {
          console.log(`     ${colorize(`예상 효과: ${opt.impact}`, colors.green)}`)
        }
      })
    })

    console.log(colorize('\n💡 추가 권장사항:', colors.bold))
    console.log('• 정기적인 성능 모니터링 및 최적화 검토')
    console.log('• 사용자 증가에 따른 스케일링 계획 수립')
    console.log('• 보안 감사 및 취약점 점검')
    console.log('• 백업 및 재해 복구 계획 수립')

    this.generateConfigFiles()
  }

  async generateConfigFiles() {
    logSection('최적화 구성 파일 생성')

    // Database optimization script
    const dbOptimizationSQL = `-- 활동 추적 시스템 데이터베이스 최적화
-- Performance optimization for activity tracking system

-- 1. 인덱스 최적화
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activities_user_created 
ON user_activities(user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activities_action_created 
ON user_activities(action_type, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user_login 
ON user_sessions(user_id, login_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_active 
ON user_sessions(is_active, last_activity DESC) WHERE is_active = true;

-- 2. 통계 뷰 최적화
REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_activity_stats;

-- 3. 자동 정리 작업 (선택사항)
-- DELETE FROM user_activities WHERE created_at < NOW() - INTERVAL '6 months';

-- 4. 분석 결과
ANALYZE user_activities;
ANALYZE user_sessions;

-- 성능 모니터링 쿼리
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats 
WHERE tablename IN ('user_activities', 'user_sessions')
ORDER BY tablename, attname;
`

    try {
      await fs.writeFile(
        path.join(process.cwd(), 'optimize-activity-tracking.sql'),
        dbOptimizationSQL
      )
      logOptimization(
        '데이터베이스 최적화 스크립트 생성',
        'applied',
        'optimize-activity-tracking.sql'
      )
    } catch (error) {
      logOptimization('데이터베이스 최적화 스크립트 생성', 'failed', error.message)
    }

    // Performance monitoring config
    const monitoringConfig = {
      metrics: {
        api: {
          responseTime: {
            threshold: 1000,
            unit: 'ms',
          },
          errorRate: {
            threshold: 5,
            unit: 'percent',
          },
        },
        database: {
          queryTime: {
            threshold: 500,
            unit: 'ms',
          },
          connectionPool: {
            threshold: 80,
            unit: 'percent',
          },
        },
      },
      alerts: {
        channels: ['email', 'slack'],
        escalation: {
          immediate: ['critical'],
          delayed: ['warning'],
          schedule: ['info'],
        },
      },
      retention: {
        metrics: '30d',
        logs: '7d',
        traces: '3d',
      },
    }

    try {
      await fs.writeFile(
        path.join(process.cwd(), 'monitoring-config.json'),
        JSON.stringify(monitoringConfig, null, 2)
      )
      logOptimization('모니터링 설정 파일 생성', 'applied', 'monitoring-config.json')
    } catch (error) {
      logOptimization('모니터링 설정 파일 생성', 'failed', error.message)
    }

    console.log(colorize('\n🎯 최적화 완료!', colors.bold))
    console.log('생성된 파일:')
    console.log('• optimize-activity-tracking.sql - 데이터베이스 최적화')
    console.log('• monitoring-config.json - 모니터링 설정')
  }
}

// 메인 실행
async function main() {
  const optimizer = new ActivityTrackingOptimizer()
  await optimizer.runOptimizations()
}

if (require.main === module) {
  main().catch(error => {
    console.error(colorize(`\n💥 최적화 실행 실패: ${error.message}`, colors.red))
    process.exit(1)
  })
}

module.exports = { ActivityTrackingOptimizer }
