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

/**
 * 공고에 붙는 장르 와일드카드. 조합원 선택지가 아니다.
 *
 * **이 값은 통과시킨다.** 한때 막았다 — 2026-09-09 실측(n=64)에서 `['전체']` 15건 중
 * 14건이 융자·행정 안내·교육·심리상담이라 "장르 특정 실패"의 표시로 봤기 때문이다.
 * 그 노이즈의 정체는 kosmart의 life 계열 카테고리였고, **지금은 수집 요청이
 * `categories=grant,gig,audition`으로 그것을 서버에서 잘라낸다**(`grantFetch.ts`).
 * 근거가 사라진 규칙만 남아 멀쩡한 공고를 막고 있었다 — 2026-W39 실측에서 `['전체']`
 * 5건이 전부 `category='grant'`였고 융자·행정은 0건이었다(화성 메세나, 크라우드펀딩
 * 챌린지, 서울거리예술창작센터 국제 워크숍, 이음 예술창작 아카데미 2건).
 */
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
 * 수집 단계의 `strictRegion=true`에 기대지 않는다 — kosmart 실측(2026-09-09)으로 같은
 * 요청을 `strictRegion=false`로 던져도 결과 64건이 **완전히 동일**했다. 즉 그 인자는
 * 지금 아무것도 거르지 않는다. 지역 판정은 여기서 우리가 직접 한다.
 *
 * 빈 배열은 통과가 아니다. `genres=[]`·`regions=[]`는 "전 장르·전국"이 아니라 **분류
 * 실패**이고, kosmart는 `regions=[]`에 제목 기반 지역 추론조차 적용하지 않아 경기·서울
 * 요청에 대구 현장 공고가 그대로 실려 온다. 반면 명시된 와일드카드는 통과시킨다 —
 * 지역은 {@link REGION_WILDCARDS}, 장르는 {@link GENRE_WILDCARD}.
 */
export function matchesInterests(
  item: { genres: string[]; regions: string[] },
  interests: EffectiveInterests
): boolean {
  const genreOk =
    item.genres.includes(GENRE_WILDCARD) || item.genres.some(g => interests.genres.includes(g))

  const regionOk =
    item.regions.some(r => REGION_WILDCARDS.has(r)) ||
    item.regions.some(r => interests.regions.includes(r))

  return genreOk && regionOk
}

/**
 * 조합 기본 관심사(음악 / 경기·서울). 조합원 개인 설정과 무관하게 **조합 전체가 보는
 * 것**(공식 게시글·인앱 알림)에 쓴다.
 *
 * 왜 필요한가: 수집 범위는 조합원 관심사의 합집합이라 한 사람이 '문학'·'제주'를 켜면
 * 풀에 그 공고가 들어온다. 게시글·알림은 개인화하지 않으므로, 필터 없이 풀을 그대로
 * 실으면 **한 사람의 설정이 조합 공식 게시물의 내용을 바꾼다.** 메일과 캘린더는 사람마다
 * 갈리므로 개인 관심사를 그대로 쓴다 — 여기만 기본값으로 좁힌다.
 */
export const DEFAULT_DIGEST_INTERESTS: EffectiveInterests = {
  genres: [...DIGEST_GENRES],
  regions: [...DIGEST_REGIONS],
}

/** {@link DEFAULT_DIGEST_INTERESTS}를 통과한 항목만. */
export function filterByDefaultInterests<T extends { genres: string[]; regions: string[] }>(
  items: T[]
): T[] {
  return items.filter(it => matchesInterests(it, DEFAULT_DIGEST_INTERESTS))
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
