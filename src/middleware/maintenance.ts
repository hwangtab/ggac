import { NextResponse } from 'next/server'
import { getMaintenanceHtml } from './templates'

/**
 * Handle Maintenance Mode Response
 * 유지보수 모드일 때 보여줄 응답을 생성합니다.
 */
export function getMaintenanceResponse(
  message: string = '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.'
) {
  return new NextResponse(getMaintenanceHtml(message), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': '3600', // 1시간 후 재시도 권장
    },
  })
}
