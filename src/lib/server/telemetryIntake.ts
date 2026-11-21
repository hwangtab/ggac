/**
 * 비로그인 수집 엔드포인트(CSP 리포트·클라이언트 오류)의 공통 방어 도구.
 * 순수 함수라 단위 테스트가 직접 import한다.
 */

export type Severity = 'low' | 'medium' | 'high'

/** CSP 리포트 한 요청에서 처리할 최대 건수 */
export const MAX_CSP_REPORTS_PER_REQUEST = 20

export function capReports<T>(reports: T[], max = MAX_CSP_REPORTS_PER_REQUEST): T[] {
  return reports.slice(0, max)
}

/**
 * 비로그인 입력으로 'high'를 만들 수 없게 상한을 `medium`으로 둔다.
 * 'high'는 외부 경보 채널(SECURITY_ALERT_WEBHOOK_URL)을 울리므로, 누구나
 * 위조 리포트를 보내 운영자를 호출할 수 있게 된다.
 */
export function capSeverityAtMedium(severity: Severity): Severity {
  return severity === 'high' ? 'medium' : severity
}

/** IPv4는 앞 두 옥텟만, IPv6는 앞 두 그룹만 남긴다. */
export function maskIp(raw: string | null | undefined): string {
  const first = (raw || '').split(',')[0].trim()
  if (!first) return 'unknown'
  if (first.includes(':')) {
    return `${first.split(':').slice(0, 2).join(':')}:*`
  }
  const parts = first.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`
  return 'unknown'
}

/** 값을 길이가 제한된 문자열로 접는다. 객체는 그대로 찍지 않는다. */
export function boundedString(value: unknown, max: number): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return '[object]'
  return String(value).slice(0, max)
}

export class BodyTooLargeError extends Error {}

/**
 * 본문을 상한 안에서만 읽는다. Content-Length가 크면 읽지 않고 거절하고,
 * 헤더가 없거나 거짓이면 읽은 뒤 길이로 다시 거른다.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError()
  const text = await request.text()
  if (text.length > maxBytes) throw new BodyTooLargeError()
  return text
}
