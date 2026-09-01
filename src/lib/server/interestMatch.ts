/**
 * 조합원 관심사 해석과 공고 매칭. **순수 함수만** 둔다 — 네트워크·DB 접근이 없다.
 *
 * 로컬 import는 `.ts`를 명시한다(`node --test` 타입 스트리핑 제약).
 */
import { isRegion, isStandardGenre } from '../../constants/interests.ts'
import { DIGEST_GENRES, DIGEST_REGIONS } from './grantDigest.ts'

/** `member_profiles`의 관심사 두 컬럼만 본다. */
export interface InterestLike {
  interest_genres?: string[] | null
  interest_regions?: string[] | null
}

export interface EffectiveInterests {
  genres: string[]
  regions: string[]
}

/** 공고에 붙는 지역 와일드카드. 조합원 선택지가 아니다. */
const REGION_WILDCARDS = new Set(['전국', '전체'])
/** 공고에 붙는 장르 와일드카드. */
const GENRE_WILDCARD = '전체'

/**
 * 이 회원에게 실제로 적용할 관심사.
 *
 * **빈 배열·null은 미설정이고, 미설정은 조합 기본값이다.** 기본값과 설정값을 합치지
 * 않는다 — 합치면 '시각예술만 보고 싶다'는 선택이 '음악도 함께'가 되어 설정이 무의미해진다.
 */
export function effectiveInterests(profile: InterestLike): EffectiveInterests {
  const g = (profile.interest_genres ?? []).filter(isStandardGenre)
  const r = (profile.interest_regions ?? []).filter(isRegion)
  return {
    genres: g.length > 0 ? g : [...DIGEST_GENRES],
    regions: r.length > 0 ? r : [...DIGEST_REGIONS],
  }
}

/**
 * 이 공고가 이 관심사에 맞나. **장르와 지역을 둘 다 만족해야 한다(AND).**
 *
 * kosmart의 BB7 규칙("장르가 정확히 겹치면 지역이 달라도 통과")을 가져오지 않는다.
 * 그 규칙은 전국 570명에게 공고를 최대한 노출하려고 만든 것이고, 우리는 이미 수집
 * 단계에서 `strictRegion=true`로 지역을 좁혀 받는다. 여기서 다시 풀면 좁혀 받은 이유가
 * 없어진다.
 */
export function matchesInterests(
  item: { genres: string[]; regions: string[] },
  interests: EffectiveInterests
): boolean {
  const genreOk =
    item.genres.includes(GENRE_WILDCARD) || item.genres.some(g => interests.genres.includes(g))

  const regionOk =
    item.regions.length === 0 ||
    item.regions.some(r => REGION_WILDCARDS.has(r)) ||
    item.regions.some(r => interests.regions.includes(r))

  return genreOk && regionOk
}

/**
 * 수집 요청에 쓸 합집합. **조합 기본값은 항상 포함된다** — 아무도 설정하지 않아도
 * 지금과 같은 공고가 들어와야 한다.
 *
 * 알 수 없는 값은 버린다. 무의미한 장르를 kosmart 요청에 실으면 그 호출은 0건을
 * 돌려주고, 호출 수만 늘어난다.
 */
export function unionInterests(profiles: InterestLike[]): EffectiveInterests {
  const genres = new Set<string>(DIGEST_GENRES)
  const regions = new Set<string>(DIGEST_REGIONS)
  for (const p of profiles) {
    for (const g of p.interest_genres ?? []) if (isStandardGenre(g)) genres.add(g)
    for (const r of p.interest_regions ?? []) if (isRegion(r)) regions.add(r)
  }
  return { genres: [...genres], regions: [...regions] }
}
