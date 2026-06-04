/**
 * CSP (Content Security Policy) 위반 리포트 수집 API
 * 브라우저에서 전송하는 CSP 위반 리포트를 수집하고 로깅
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { logSecurityEvent } from '@/utils/security'

interface CSPReport {
  'csp-report': {
    'document-uri': string
    referrer: string
    'violated-directive': string
    'effective-directive': string
    'original-policy': string
    disposition: string
    'blocked-uri': string
    'line-number'?: number
    'column-number'?: number
    'source-file'?: string
  }
}

async function parseJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * CSP 위반 리포트 수집
 */
export async function POST(request: NextRequest) {
  try {
    const report = (await parseJsonBody(request)) as CSPReport | null

    if (!report?.['csp-report']) {
      return createErrorResponse({ success: false, error: 'Invalid CSP report format' }, 400)
    }

    const cspReport = report['csp-report']

    // 민감한 정보 필터링
    const sanitizedReport = {
      documentUri: cspReport['document-uri']?.replace(/[?#].*$/, ''), // 쿼리 파라미터 제거
      violatedDirective: cspReport['violated-directive'],
      effectiveDirective: cspReport['effective-directive'],
      blockedUri: cspReport['blocked-uri']?.replace(/^data:.*/, 'data:[filtered]'), // data URI 내용 제거
      disposition: cspReport.disposition,
      sourceFile: cspReport['source-file']?.replace(/[?#].*$/, ''),
      lineNumber: cspReport['line-number'],
      columnNumber: cspReport['column-number'],
    }

    // 무시할 위반 패턴들 (false positive 제거)
    const ignoredPatterns = [
      // 브라우저 확장 프로그램
      /^chrome-extension:/,
      /^moz-extension:/,
      /^safari-extension:/,
      // 개발 도구
      /localhost.*hot-update/,
      /webpack.*hot-update/,
      // 알려진 false positive
      /^about:/,
      /^blob:.*hot-update/,
    ]

    const shouldIgnore = ignoredPatterns.some(
      pattern =>
        pattern.test(sanitizedReport.blockedUri || '') ||
        pattern.test(sanitizedReport.sourceFile || '')
    )

    if (shouldIgnore) {
      console.log('[CSP] 무시된 위반 리포트:', sanitizedReport.blockedUri)
      return NextResponse.json({ status: 'ignored' })
    }

    // 심각도 판단
    let severity: 'low' | 'medium' | 'high' = 'medium'

    if (sanitizedReport.violatedDirective?.includes('script-src')) {
      severity = 'high' // 스크립트 관련 위반은 높은 위험도
    } else if (sanitizedReport.violatedDirective?.includes('style-src')) {
      severity = 'medium'
    } else if (sanitizedReport.violatedDirective?.includes('img-src')) {
      severity = 'low'
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'CSP_VIOLATION',
      {
        ...sanitizedReport,
        userAgent: request.headers.get('user-agent')?.substring(0, 200),
        clientIP:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        timestamp: new Date().toISOString(),
      },
      severity
    )

    console.log(`[CSP] ${severity.toUpperCase()} 위반 리포트:`, {
      directive: sanitizedReport.violatedDirective,
      blockedUri: sanitizedReport.blockedUri,
      documentUri: sanitizedReport.documentUri,
    })

    // 프로덕션에서는 외부 보안 모니터링 서비스로 전송 가능
    if (process.env.NODE_ENV === 'production' && process.env.SECURITY_WEBHOOK_URL) {
      try {
        await fetch(process.env.SECURITY_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'csp_violation',
            severity,
            report: sanitizedReport,
            timestamp: new Date().toISOString(),
          }),
        })
      } catch (webhookError) {
        console.error('[CSP] 보안 웹훅 전송 실패:', webhookError)
      }
    }

    return NextResponse.json({ status: 'received' })
  } catch (error) {
    console.error('[CSP] 리포트 처리 중 오류:', error)
    return createErrorResponse({ success: false, error: 'Internal server error' }, 500)
  }
}
