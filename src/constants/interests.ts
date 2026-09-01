/**
 * 조합원 관심사 선택지의 정본.
 *
 * **kosmart의 값과 같아야 한다.** 장르는 kosmart `src/lib/opportunities/taxonomy.ts`의
 * `STANDARD_GENRES`, 지역은 그 파일의 시도 목록과 같은 문자열이다. 여기 값이 kosmart와
 * 어긋나면 조합원이 고른 관심사가 kosmart 요청에 실려도 **0건이 돌아온다** — 에러 없이,
 * 화면에는 설정된 것처럼 보이는 채로.
 *
 * 런타임에 kosmart를 조회해 받아오지 않는 이유: 선택지 10개·17개는 거의 바뀌지 않고,
 * 설정 화면이 외부 API 응답을 기다리게 만들 이유가 없다. **kosmart가 목록을 바꾸면
 * 여기도 함께 고쳐야 한다.**
 */
export const STANDARD_GENRES = [
  '문학',
  '시각예술',
  '연극',
  '뮤지컬',
  '무용',
  '음악',
  '전통예술',
  '다원예술',
  '문화일반',
  '기타',
] as const

export type StandardGenre = (typeof STANDARD_GENRES)[number]

/** 17개 시도. `'전국'`은 **공고에 붙는 와일드카드**이지 조합원이 고를 값이 아니다. */
export const REGIONS = [
  '서울',
  '부산',
  '대구',
  '인천',
  '광주',
  '대전',
  '울산',
  '세종',
  '경기',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
] as const

export type Region = (typeof REGIONS)[number]

export function isStandardGenre(value: unknown): value is StandardGenre {
  return typeof value === 'string' && (STANDARD_GENRES as readonly string[]).includes(value)
}

export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value)
}
