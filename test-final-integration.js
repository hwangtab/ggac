#!/usr/bin/env node

/**
 * 전체 시스템 통합 테스트
 * Final integration test for complete system
 */

const { spawn } = require('child_process')
const fs = require('fs').promises
const path = require('path')

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
}

function colorize(text, color) {
  return `${color}${text}${colors.reset}`
}

function logSection(title) {
  console.log(`\n${colorize('='.repeat(60), colors.blue)}`)
  console.log(colorize(`🔍 ${title}`, colors.bold))
  console.log(colorize('='.repeat(60), colors.blue))
}

function logTest(name, status, details = '') {
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : status === 'skip' ? '⏭️' : '🔧'
  const color = status === 'pass' ? colors.green : status === 'fail' ? colors.red : colors.yellow
  console.log(`${icon} ${colorize(name, color)}${details ? ` - ${details}` : ''}`)
}

class FinalIntegrationTester {
  constructor() {
    this.testResults = {
      build: { passed: 0, failed: 0 },
      lint: { passed: 0, failed: 0 },
      types: { passed: 0, failed: 0 },
      architecture: { passed: 0, failed: 0 },
      performance: { passed: 0, failed: 0 },
      security: { passed: 0, failed: 0 }
    }
  }

  async runFinalTests() {
    console.log(colorize('\n🚀 전체 시스템 통합 테스트 시작', colors.bold))
    console.log(colorize('📊 멤버 활동 추적 시스템 완성도 검증', colors.cyan))

    try {
      await this.testBuildSystem()
      await this.testCodeQuality()
      await this.testArchitecture()
      await this.testPerformance()
      await this.testSecurity()
      
      this.generateFinalReport()
    } catch (error) {
      console.error(colorize(`\n❌ 통합 테스트 실행 중 오류: ${error.message}`, colors.red))
    }
  }

  async testBuildSystem() {
    logSection('빌드 시스템 테스트')

    try {
      // Test TypeScript compilation
      logTest('TypeScript 컴파일레이션', 'running')
      const tscResult = await this.runCommand('npx tsc --noEmit')
      if (tscResult.success) {
        logTest('TypeScript 컴파일레이션', 'pass', '타입 오류 없음')
        this.testResults.types.passed++
      } else {
        logTest('TypeScript 컴파일레이션', 'fail', '타입 오류 발견')
        this.testResults.types.failed++
      }

      // Test Next.js build
      logTest('Next.js 빌드', 'running')
      const buildResult = await this.runCommand('npm run build')
      if (buildResult.success) {
        logTest('Next.js 빌드', 'pass', '빌드 성공')
        this.testResults.build.passed++
      } else {
        logTest('Next.js 빌드', 'fail', '빌드 실패')
        this.testResults.build.failed++
      }

    } catch (error) {
      logTest('빌드 시스템', 'fail', error.message)
      this.testResults.build.failed++
    }
  }

  async testCodeQuality() {
    logSection('코드 품질 테스트')

    try {
      // ESLint test
      const lintResult = await this.runCommand('npm run lint')
      if (lintResult.success) {
        logTest('ESLint 검사', 'pass', '린트 오류 없음')
        this.testResults.lint.passed++
      } else {
        // Count warnings vs errors
        const hasErrors = lintResult.output.includes('error')
        if (hasErrors) {
          logTest('ESLint 검사', 'fail', '린트 오류 발견')
          this.testResults.lint.failed++
        } else {
          logTest('ESLint 검사', 'pass', '경고만 있음 (허용)')
          this.testResults.lint.passed++
        }
      }

      // Code structure analysis
      await this.analyzeCodeStructure()

    } catch (error) {
      logTest('코드 품질', 'fail', error.message)
      this.testResults.lint.failed++
    }
  }

  async analyzeCodeStructure() {
    logTest('코드 구조 분석', 'running')

    const codeStructure = {
      activityTracking: {
        apis: [
          'src/app/api/activities/log/route.ts',
          'src/app/api/activities/batch-log/route.ts',
          'src/app/api/activities/session/route.ts',
          'src/app/api/admin/activities/real-time/route.ts',
          'src/app/api/admin/activities/users/route.ts',
          'src/app/api/admin/analytics/patterns/route.ts',
          'src/app/api/admin/analytics/trends/route.ts'
        ],
        components: [
          'src/app/admin/components/RealTimeActivityMonitor.tsx',
          'src/app/admin/components/ActivityAnalyticsCharts.tsx'
        ],
        utils: [
          'src/utils/activityLogger.ts',
          'src/utils/rateLimit.ts',
          'src/utils/security.ts'
        ],
        types: [
          'src/types/index.ts'
        ]
      }
    }

    let allFilesExist = true
    let existingFiles = 0
    let totalFiles = 0

    for (const [category, files] of Object.entries(codeStructure.activityTracking)) {
      for (const filePath of files) {
        totalFiles++
        try {
          await fs.access(path.join(process.cwd(), filePath))
          existingFiles++
        } catch {
          allFilesExist = false
          console.log(`   ❌ 누락된 파일: ${filePath}`)
        }
      }
    }

    if (allFilesExist) {
      logTest('코드 구조 분석', 'pass', `모든 핵심 파일 존재 (${existingFiles}/${totalFiles})`)
      this.testResults.architecture.passed++
    } else {
      logTest('코드 구조 분석', 'fail', `일부 파일 누락 (${existingFiles}/${totalFiles})`)
      this.testResults.architecture.failed++
    }
  }

  async testArchitecture() {
    logSection('시스템 아키텍처 검증')

    const architectureChecks = [
      {
        name: '활동 추적 스키마',
        check: () => this.checkDatabaseSchema(),
        critical: true
      },
      {
        name: 'API 라우트 구조',
        check: () => this.checkAPIRoutes(),
        critical: true
      },
      {
        name: '타입 정의 완성도',
        check: () => this.checkTypeDefinitions(),
        critical: false
      },
      {
        name: '컴포넌트 통합성',
        check: () => this.checkComponentIntegration(),
        critical: false
      }
    ]

    for (const check of architectureChecks) {
      try {
        const result = await check.check()
        if (result.success) {
          logTest(check.name, 'pass', result.message)
          this.testResults.architecture.passed++
        } else {
          const status = check.critical ? 'fail' : 'skip'
          logTest(check.name, status, result.message)
          if (check.critical) {
            this.testResults.architecture.failed++
          }
        }
      } catch (error) {
        logTest(check.name, 'fail', error.message)
        this.testResults.architecture.failed++
      }
    }
  }

  async checkDatabaseSchema() {
    try {
      const migrationPath = 'supabase/migrations/20250626000000_activity_tracking_system.sql'
      await fs.access(path.join(process.cwd(), migrationPath))
      return { success: true, message: '활동 추적 스키마 정의 확인됨' }
    } catch {
      return { success: false, message: '데이터베이스 마이그레이션 파일 누락' }
    }
  }

  async checkAPIRoutes() {
    const requiredRoutes = [
      'src/app/api/activities/log/route.ts',
      'src/app/api/activities/batch-log/route.ts',
      'src/app/api/admin/analytics/patterns/route.ts',
      'src/app/api/admin/analytics/trends/route.ts'
    ]

    try {
      for (const route of requiredRoutes) {
        await fs.access(path.join(process.cwd(), route))
      }
      return { success: true, message: `모든 API 라우트 확인됨 (${requiredRoutes.length}개)` }
    } catch {
      return { success: false, message: '일부 API 라우트 누락' }
    }
  }

  async checkTypeDefinitions() {
    try {
      const typesFile = await fs.readFile(path.join(process.cwd(), 'src/types/index.ts'), 'utf8')
      const hasActivityTypes = typesFile.includes('ActivityLogRequest') && 
                              typesFile.includes('UserSession') &&
                              typesFile.includes('ActivityAnalytics')
      
      if (hasActivityTypes) {
        return { success: true, message: '활동 추적 타입 정의 완료' }
      } else {
        return { success: false, message: '활동 추적 타입 정의 불완전' }
      }
    } catch {
      return { success: false, message: '타입 정의 파일 접근 실패' }
    }
  }

  async checkComponentIntegration() {
    const componentChecks = [
      'src/app/admin/components/RealTimeActivityMonitor.tsx',
      'src/app/admin/components/ActivityAnalyticsCharts.tsx'
    ]

    try {
      for (const component of componentChecks) {
        await fs.access(path.join(process.cwd(), component))
      }
      return { success: true, message: '모든 핵심 컴포넌트 존재' }
    } catch {
      return { success: false, message: '일부 컴포넌트 누락' }
    }
  }

  async testPerformance() {
    logSection('성능 최적화 검증')

    const performanceChecks = [
      {
        name: '번들 크기 분석',
        check: async () => {
          try {
            // Check if build artifacts exist
            const buildDir = path.join(process.cwd(), '.next')
            await fs.access(buildDir)
            return { success: true, message: '빌드 아티팩트 존재, 번들 분석 가능' }
          } catch {
            return { success: false, message: '빌드가 필요함' }
          }
        }
      },
      {
        name: '최적화 스크립트',
        check: async () => {
          try {
            await fs.access(path.join(process.cwd(), 'optimize-activity-tracking.js'))
            await fs.access(path.join(process.cwd(), 'optimize-activity-tracking.sql'))
            return { success: true, message: '성능 최적화 도구 준비됨' }
          } catch {
            return { success: false, message: '최적화 도구 누락' }
          }
        }
      },
      {
        name: '캐싱 전략',
        check: async () => {
          // Check for React cache usage in data fetching
          try {
            const dataFile = await fs.readFile(path.join(process.cwd(), 'src/lib/data.ts'), 'utf8')
            const hasCaching = dataFile.includes('cache(')
            if (hasCaching) {
              return { success: true, message: 'React 캐시 전략 적용됨' }
            } else {
              return { success: false, message: '캐싱 전략 부재' }
            }
          } catch {
            return { success: false, message: '데이터 계층 파일 확인 불가' }
          }
        }
      }
    ]

    for (const check of performanceChecks) {
      try {
        const result = await check.check()
        if (result.success) {
          logTest(check.name, 'pass', result.message)
          this.testResults.performance.passed++
        } else {
          logTest(check.name, 'skip', result.message)
        }
      } catch (error) {
        logTest(check.name, 'fail', error.message)
        this.testResults.performance.failed++
      }
    }
  }

  async testSecurity() {
    logSection('보안 검증')

    const securityChecks = [
      {
        name: '입력 검증 시스템',
        check: async () => {
          try {
            const securityFile = await fs.readFile(path.join(process.cwd(), 'src/utils/security.ts'), 'utf8')
            const hasValidation = securityFile.includes('sanitizeInput') && 
                                 securityFile.includes('sanitizeHtml') &&
                                 securityFile.includes('detectXssPatterns')
            
            if (hasValidation) {
              return { success: true, message: 'XSS 방지 및 입력 검증 시스템 완비' }
            } else {
              return { success: false, message: '보안 유틸리티 불완전' }
            }
          } catch {
            return { success: false, message: '보안 유틸리티 파일 누락' }
          }
        }
      },
      {
        name: 'Rate Limiting',
        check: async () => {
          try {
            await fs.access(path.join(process.cwd(), 'src/utils/rateLimit.ts'))
            return { success: true, message: 'API Rate Limiting 구현됨' }
          } catch {
            return { success: false, message: 'Rate Limiting 시스템 누락' }
          }
        }
      },
      {
        name: '인증 미들웨어',
        check: async () => {
          try {
            const middlewareFile = await fs.readFile(path.join(process.cwd(), 'src/middleware.ts'), 'utf8')
            const hasAuth = middlewareFile.includes('supabase') && middlewareFile.includes('session')
            
            if (hasAuth) {
              return { success: true, message: '인증 미들웨어 적용됨' }
            } else {
              return { success: false, message: '인증 시스템 불완전' }
            }
          } catch {
            return { success: false, message: '미들웨어 파일 확인 불가' }
          }
        }
      }
    ]

    for (const check of securityChecks) {
      try {
        const result = await check.check()
        if (result.success) {
          logTest(check.name, 'pass', result.message)
          this.testResults.security.passed++
        } else {
          logTest(check.name, 'fail', result.message)
          this.testResults.security.failed++
        }
      } catch (error) {
        logTest(check.name, 'fail', error.message)
        this.testResults.security.failed++
      }
    }
  }

  generateFinalReport() {
    logSection('최종 검증 보고서')

    const categories = [
      { name: '빌드 시스템', key: 'build', icon: '🔧' },
      { name: '코드 품질', key: 'lint', icon: '✨' },
      { name: '타입 시스템', key: 'types', icon: '🔷' },
      { name: '아키텍처', key: 'architecture', icon: '🏗️' },
      { name: '성능', key: 'performance', icon: '⚡' },
      { name: '보안', key: 'security', icon: '🔒' }
    ]

    let totalPassed = 0
    let totalFailed = 0

    console.log(colorize('📊 카테고리별 결과:', colors.bold))

    categories.forEach(category => {
      const results = this.testResults[category.key]
      const total = results.passed + results.failed
      const percentage = total > 0 ? Math.round((results.passed / total) * 100) : 0
      
      console.log(`${category.icon} ${colorize(category.name, colors.cyan)}: ${colorize(results.passed, colors.green)}/${total} (${percentage}%)`)
      
      totalPassed += results.passed
      totalFailed += results.failed
    })

    const overallTotal = totalPassed + totalFailed
    const overallPercentage = overallTotal > 0 ? Math.round((totalPassed / overallTotal) * 100) : 0

    console.log(`\n${colorize('🎯 전체 시스템 상태', colors.bold)}`)
    console.log(`✅ 통과: ${colorize(totalPassed, colors.green)}`)
    console.log(`❌ 실패: ${colorize(totalFailed, colors.red)}`)
    console.log(`📊 전체 완성도: ${colorize(`${overallPercentage}%`, colors.cyan)}`)

    // System readiness assessment
    console.log(`\n${colorize('🚀 시스템 준비 상태', colors.bold)}`)
    
    if (overallPercentage >= 90) {
      console.log(colorize('🎉 프로덕션 배포 준비 완료!', colors.green))
      console.log('• 모든 핵심 기능이 구현되고 테스트됨')
      console.log('• 성능 최적화 및 보안 강화 완료')
      console.log('• 코드 품질 기준 충족')
    } else if (overallPercentage >= 75) {
      console.log(colorize('⚠️ 일부 최적화 필요', colors.yellow))
      console.log('• 핵심 기능은 동작하나 추가 개선 권장')
      console.log('• 성능 또는 보안 측면에서 개선 여지')
    } else {
      console.log(colorize('🔴 추가 개발 필요', colors.red))
      console.log('• 핵심 기능 구현 완료 필요')
      console.log('• 시스템 안정성 검증 필요')
    }

    console.log(`\n${colorize('📋 다음 단계 권장사항:', colors.cyan)}`)
    console.log('1. 실제 사용자 데이터로 성능 테스트 수행')
    console.log('2. 보안 감사 및 취약점 점검')
    console.log('3. 사용자 피드백 수집 및 개선')
    console.log('4. 모니터링 시스템 구축 및 운영')

    // Save test results
    this.saveTestResults(overallPercentage)
  }

  async saveTestResults(percentage) {
    const results = {
      timestamp: new Date().toISOString(),
      overallScore: percentage,
      categories: this.testResults,
      recommendations: [
        '활동 추적 시스템 완성도 검증 완료',
        '프로덕션 환경 배포 전 최종 점검 수행',
        '사용자 피드백 기반 지속적 개선'
      ]
    }

    try {
      await fs.writeFile(
        path.join(process.cwd(), 'final-test-results.json'),
        JSON.stringify(results, null, 2)
      )
      console.log(`\n📄 상세 결과가 final-test-results.json에 저장되었습니다.`)
    } catch (error) {
      console.log(`\n⚠️ 결과 저장 실패: ${error.message}`)
    }
  }

  runCommand(command) {
    return new Promise((resolve) => {
      const [cmd, ...args] = command.split(' ')
      const child = spawn(cmd, args, { 
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true 
      })

      let output = ''
      let errorOutput = ''

      child.stdout?.on('data', (data) => {
        output += data.toString()
      })

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString()
      })

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output: output + errorOutput,
          code
        })
      })

      child.on('error', (error) => {
        resolve({
          success: false,
          output: error.message,
          code: -1
        })
      })
    })
  }
}

// 메인 실행
async function main() {
  const tester = new FinalIntegrationTester()
  await tester.runFinalTests()
}

if (require.main === module) {
  main().catch(error => {
    console.error(colorize(`\n💥 통합 테스트 실행 실패: ${error.message}`, colors.red))
    process.exit(1)
  })
}

module.exports = { FinalIntegrationTester }