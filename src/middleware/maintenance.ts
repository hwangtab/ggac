import { NextResponse } from 'next/server'
import { getMaintenanceHtml } from './templates'

/**
 * Handle Maintenance Mode Response
 * 유지보수 모드일 때 보여줄 응답을 생성합니다.
 *
 * isApi가 true면 API 클라이언트용 JSON 503을 준다. HTML 503을 API 클라이언트에
 * 주면 res.json()이 파싱 오류로 죽어 원인이 가려진다.
 */
export function getMaintenanceResponse(
  message: string = '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.',
  options: { isApi?: boolean } = {}
) {
  if (options.isApi) {
    // 본문 키는 이 저장소의 에러 계약(`error`)을 따른다 — apiWrapper.ts:167.
    return NextResponse.json(
      { success: false, error: message },
      { status: 503, headers: { 'Retry-After': '3600' } }
    )
  }
  return new NextResponse(getMaintenanceHtml(message), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': '3600', // 1시간 후 재시도 권장
    },
  })
}
