/**
 * CSP (Content Security Policy) 위반 리포트 수집 API
 *
 * **두 가지 형식을 모두 받는다.** 우리가 내보내는 정책에는 `report-uri`와
 * `report-to`가 둘 다 붙어 있고(`src/middleware/csp.ts`, `next.config.js`),
 * 브라우저는 그에 따라 서로 다른 본문을 보낸다:
 *
 * - 레거시(`report-uri`): `{"csp-report": { "document-uri": ..., ... }}`
 * - Reporting API(`report-to`/`Reporting-Endpoints`):
 *   `[{"type":"csp-violation","body":{ "documentURL": ..., ... }}]` —
 *   배열이고, 키 이름도 카멜케이스로 다르다.
 *
 * 예전에는 레거시 모양만 받고 나머지를 400으로 돌려보냈다. 크롬은 이미
 * Reporting API 쪽으로 보내므로, CSP 감시가 신호를 하나도 못 받으면서
 * "조용하다"를 "위반이 없다"로 읽게 만들고 있었다.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { logSecurityEvent } from '@/utils/security'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/security/csp-report')

async function parseJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function getReportObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function sanitizeReportString(value: unknown, maxLength = 1024): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function sanitizeReportNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Reporting API 본문을 레거시 키 이름으로 접는다.
 *
 * 두 형식은 같은 값을 다른 이름으로 부를 뿐이다(`documentURL` ↔
 * `document-uri`, `blockedURL` ↔ `blocked-uri`, …). 여기서 한 번 접어 두면
 * 아래 정제·판정 코드는 한 벌만 있으면 된다. Reporting API 본문에는
 * `violated-directive`에 해당하는 칸이 없어 `effectiveDirective`를 쓴다 —
 * 레거시에서도 두 값은 사실상 같은 것을 가리킨다.
 */
function toLegacyShape(body: Record<string, unknown>): Record<string, unknown> {
  return {
    'document-uri': body['document-uri'] ?? body.documentURL,
    referrer: body.referrer,
    'violated-directive': body['violated-directive'] ?? body.effectiveDirective,
    'effective-directive': body['effective-directive'] ?? body.effectiveDirective,
    'original-policy': body['original-policy'] ?? body.originalPolicy,
    disposition: body.disposition,
    'blocked-uri': body['blocked-uri'] ?? body.blockedURL,
    'line-number': body['line-number'] ?? body.lineNumber,
    'column-number': body['column-number'] ?? body.columnNumber,
    'source-file': body['source-file'] ?? body.sourceFile,
  }
}

/**
 * 본문에서 CSP 위반 리포트를 꺼낸다. 하나도 못 꺼내면 빈 배열이다(→ 400).
 *
 * Reporting API는 **여러 건을 한 번에** 보내고 CSP 말고 다른 종류
 * (`deprecation`·`intervention`)도 같은 봉투에 섞어 보낸다. `type`이
 * `csp-violation`인 것만 집는다 — 아니면 감시 로그가 CSP와 무관한 것들로
 * 오염된다.
 */
function extractCspReports(payload: unknown): Record<string, unknown>[] {
  // Reporting API — 배열, 또는 봉투 하나만 오는 경우.
  const envelopes = Array.isArray(payload) ? payload : [payload]
  const fromReportingApi = envelopes
    .map(getReportObject)
    .filter(
      (entry): entry is Record<string, unknown> => entry !== null && entry.type === 'csp-violation'
    )
    .map(entry => getReportObject(entry.body))
    .filter((body): body is Record<string, unknown> => body !== null)
    .map(toLegacyShape)

  if (fromReportingApi.length > 0) return fromReportingApi

  // 레거시 `report-uri` — `{"csp-report": {...}}`.
  const envelope = getReportObject(payload)
  const legacy = envelope ? getReportObject(envelope['csp-report']) : null
  return legacy ? [legacy] : []
}

/**
 * CSP 위반 리포트 수집
 */
export async function POST(request: NextRequest) {
  try {
    const reports = extractCspReports(await parseJsonBody(request))
    if (reports.length === 0) {
      return ApiError.badRequest('Invalid CSP report format').toNextResponse()
    }

    let received = 0
    let ignored = 0

    for (const cspReport of reports) {
      // 민감한 정보 필터링
      const sanitizedReport = {
        documentUri: sanitizeReportString(cspReport['document-uri']).replace(/[?#].*$/, ''), // 쿼리 파라미터 제거
        violatedDirective: sanitizeReportString(cspReport['violated-directive'], 200),
        effectiveDirective: sanitizeReportString(cspReport['effective-directive'], 200),
        blockedUri: sanitizeReportString(cspReport['blocked-uri']).replace(
          /^data:.*/,
          'data:[filtered]'
        ), // data URI 내용 제거
        disposition: sanitizeReportString(cspReport.disposition, 100),
        sourceFile: sanitizeReportString(cspReport['source-file']).replace(/[?#].*$/, ''),
        lineNumber: sanitizeReportNumber(cspReport['line-number']),
        columnNumber: sanitizeReportNumber(cspReport['column-number']),
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
        log.debug('Ignored CSP report', { blockedUri: sanitizedReport.blockedUri })
        ignored += 1
        continue
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

      log.debug('CSP violation report collected', {
        severity,
        directive: sanitizedReport.violatedDirective,
        blockedUri: sanitizedReport.blockedUri,
        documentUri: sanitizedReport.documentUri,
      })

      received += 1

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
    }

    // 봉투 하나에 여러 건이 올 수 있으므로 건수를 함께 돌려준다.
    return ApiSuccess.ok({
      status: received > 0 ? 'received' : 'ignored',
      received,
      ignored,
    }).toNextResponse()
  } catch (error) {
    console.error('[CSP] 리포트 처리 중 오류:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
