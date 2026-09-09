/**
 * 예술지원사업 주간 회차의 판정과 렌더링.
 *
 * **순수 함수만 둔다** — 네트워크·DB 접근이 없다. 그래야 중복 발송·주차 경계·이스케이프
 * 같은 것을 `node --test`로 전수 고정할 수 있다(`src/lib/payments/billingRun.ts`와 같은 배치).
 *
 * 로컬 import는 타입만 쓴다 — `node --test`의 타입 스트리핑 모드는 확장자 없는 로컬
 * import를 해석하지 못하므로 `.ts`를 명시한다.
 */
import type { GrantItem } from '../../db/queries/grantDigests.ts'

/** 조합이 다루는 장르. kosmart `taxonomy.ts:11 STANDARD_GENRES`의 값과 같아야 한다. */
export const DIGEST_GENRES = ['음악'] as const

/** 조합원 활동 지역. '전국'/'전체' 공고는 kosmart가 지역 무관으로 통과시킨다. */
export const DIGEST_REGIONS = ['경기', '서울'] as const

/**
 * 마감이 오늘부터 이 일수 안에 있는 공고만 받는다.
 *
 * 90인 이유: kosmart 실측으로 7일 창을 쓰던 시절 "마감 30일 이상 남은 73건 중
 * 61건(84%)이 창 밖"이었다. 마감이 두 달 뒤인 공고를 지금 알리는 편이 조합원에게 이득이다.
 */
export const WINDOW_DAYS = 90

/**
 * **메일 한 통**에 담을 공고 수 상한.
 *
 * 20인 이유: 2026-W37 실측에서 관리자가 남긴 공고가 14건이었는데 옛 상한 12가 꼬리
 * 2건을 조용히 잘랐다 — 게시글은 14건, 알림은 14건, 메일만 12건이라 세 숫자가 갈렸고
 * 어느 화면도 잘렸다고 말하지 않았다. 20이면 실측 규모(active 14)에 여유가 있고,
 * 그래도 넘치면 {@link sortByDeadline}으로 마감 임박순으로 정렬한 뒤 자르며 메일 본문과
 * 관리자 화면이 잘린 사실을 함께 알린다.
 */
export const CAP = 20

/**
 * 한 회차의 공고 풀 상한. `CAP`(12)은 **메일 한 통**의 상한이고 이것은 **풀 전체**의
 * 상한이다 — 개인화 이후 메일은 사람마다 갈리므로 두 값이 갈라진다.
 *
 * 60인 근거: 게시글 하나에 담을 만한 양이면서(60건 × 4줄 ≈ 240줄), 실측한 장르 셋
 * 규모(경기·서울 × 음악+시각예술+다원예술 = 93건)에서 관리자가 검수할 수 있는 크기다.
 * 넘치면 kosmart가 이미 점수순으로 정렬해 보내므로 뒤가 잘린다.
 */
export const POOL_CAP = 60

/**
 * 캘린더가 거슬러 읽는 발행 회차 수(`src/db/queries/calendar.ts`).
 *
 * 마감이 최대 `WINDOW_DAYS`(90일) 뒤이므로 넉넉히 잡는다.
 */
export const DIGEST_LOOKBACK_WEEKS = 26

/**
 * 중복 제거에 볼 과거 회차 수. **캘린더가 읽는 범위와 같은 값이어야 한다** —
 * 짧으면 캘린더가 아직 보고 있는 옛 회차의 공고가 새 초안에 다시 담긴다(같은 공고가
 * 캘린더에 두 번 찍힌다).
 */
export const DEDUPE_WEEKS = DIGEST_LOOKBACK_WEEKS

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** KST 기준 오늘(YYYY-MM-DD). */
export function kstTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * KST 기준 ISO 주차 `'YYYY-Www'`.
 *
 * UTC로 판정하면 안 된다 — 크론이 일요일 23:00 UTC(= 월요일 08:00 KST)에 도는데,
 * UTC 기준으로는 아직 지난 주차다. 그러면 월요일 발행분이 지난 주 회차에 덮어써진다.
 */
export function weekKey(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  // ISO 주차: 그 주 목요일이 속한 해의 주차다.
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()))
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay() // 월=1 … 일=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // 그 주 목요일로 이동
  const year = d.getUTCFullYear()
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * 장르별 블록을 한 건씩 번갈아 뽑아 하나의 배열로 섞는다. **순수 함수** — `grantFetch.ts`가
 * 만든 `GenreBlock[]`을 `buildDraftItems`에 넘기기 전에 쓴다.
 *
 * **왜 필요한가**: `grantFetch.ts`는 장르별 블록을 `scope.genres` 순서대로 돌려주는데,
 * 그 순서는 조합 기본값(음악)이 항상 먼저다. 블록을 그대로 이어붙여 `buildDraftItems`에
 * 넘기면 앞 장르가 `POOL_CAP`을 다 채워버리는 주가 온다 — 그러면 뒤 장르만 고른 조합원은
 * 매주 공고 0건을 받는다. 라운드로빈으로 섞으면 각 장르가 공평한 몫을 갖고, 어느 장르가
 * 그 몫을 못 채우면(블록이 짧으면) 그 장르는 자연히 순환에서 빠지고 남은 장르가 빈 자리를
 * 채운다 — 자리가 낭비되지 않는다.
 *
 * **블록이 하나뿐이면(장르 미설정 — 지금 모든 조합원의 상태) 원래 순서를 그대로 보존한다**
 * — 매 순환마다 그 블록에서 한 건씩 순서대로 꺼내는 것과 같으므로 결과가 입력과 동일하다.
 * 이게 깨지면 미설정 조합원에게 회귀다.
 */
export function interleaveGenreBlocks(blocks: GrantItem[][]): GrantItem[] {
  const out: GrantItem[] = []
  const indices = blocks.map(() => 0)
  let remaining = blocks.reduce((sum, b) => sum + b.length, 0)
  while (remaining > 0) {
    for (let i = 0; i < blocks.length; i++) {
      if (indices[i] >= blocks[i].length) continue
      out.push(blocks[i][indices[i]])
      indices[i] += 1
      remaining -= 1
    }
  }
  return out
}

/**
 * 제목만으로 조합원과 무관한 공고를 거른다.
 *
 * kosmart는 장르를 `genres=['음악']`으로만 분류해 보내므로, 합창단·무용 등
 * 실험음악·중음악(둠메탈·드론·슬러지) 조합원과 무관한 공고가 장르 필터를 통과해 섞인다.
 * 장르 태그로는 거를 수 없어 제목 문자열로 판정한다.
 *
 * 키워드는 {@link EXCLUDE_TITLE_KEYWORDS} 목록만 쓴다 — 넓히면 「커넥트 스테이지(연극·
 * 무용·음악·전통) 통합공모」처럼 음악도 받는 유효한 공고가 함께 걸린다.
 */
export function isExcludedByTitle(title: string): boolean {
  return EXCLUDE_TITLE_KEYWORDS.some(keyword => title.includes(keyword))
}

/**
 * 제목 기반 제외 키워드.
 *
 * - `합창`: 종로구립합창단 신규단원 모집, 종로구립어르신합창단 지도단원 모집, 무용·합창
 *   워크숍 참여자 모집 세 건이 전부 이 키워드로 걸린다. 「커넥트 스테이지(연극·무용·음악·
 *   전통) 통합공모」처럼 음악도 받는 공고는 제목에 '합창'이 없어 안 걸린다.
 * - `모집`: 사람을 뽑는 공고를 잡는다. 기관 소속 단원 채용(구립합창단·시립교향악단류)과
 *   2026-W37 실측 3번 「2026년 꿈의 극단 안산 예술감독 모집」(`biz_type='인력, 기타'`,
 *   `category='grant'`)이 여기 걸린다. 그 항목은 채용 공고인데 카테고리·장르·biz_type
 *   어느 규칙에도 안 걸려 게시글·메일·캘린더에 전부 실렸다.
 *   `단원`을 따로 두지 않는 이유는 「지도단원(알토) 모집」을 포함해 실측된 단원 채용
 *   공고가 전부 '모집'으로 끝나서 이 키워드가 덮기 때문이다.
 * - `무용`을 넣지 않는 이유: 「서울 커넥트 스테이지(연극·무용·음악·전통) 통합공모」가
 *   함께 걸린다 — 음악도 받는 유효한 창작지원이다. 순수 무용 공고는 `genres=['무용']`
 *   이라 관심사 필터가 이미 거른다.
 */
export const EXCLUDE_TITLE_KEYWORDS = [
  '합창',
  '모집',
  // 2026-W37 실측: '안내'만으로 거르면 유효한 공모(8번 「2027년 해외 우수 콘텐츠 지역
  // 네트워크 사업 공모 안내」, 19·20번 「이음 예술창작 아카데미 …과정 안내」)까지 함께
  // 걸린다. 그래서 '안내' 단독이 아니라 앞말이 붙은 두 어절을 정확히 쓴다.
  // - '제출 안내': 「예술활동준비금지원사업 예술활동보고서 제출 안내」처럼 행정 서류
  //   제출을 알리는 공고를 잡는다. 지원사업 자체가 아니라 이미 받은 사업의 사후 절차다.
  // - '제도 운영 안내': 「예술활동증명 제도 운영 안내」처럼 제도 자체를 설명하는 공고를
  //   잡는다. 공모·모집이 아니라 행정 안내문이다.
  '제출 안내',
  '제도 운영 안내',
] as const

/**
 * kosmart가 장르 분류에 실패해 `genres`가 빈 배열로 오는 공고를 거른다.
 *
 * 관심사와 맞는지 판정할 수 없고, 발행 시 개인 필터(`matchesInterests`)가 어차피
 * 떨어뜨려 메일에는 안 나간다 — 게시글에만 실려 노이즈가 된다(2026-W37 실측 13·15번).
 *
 * `genres=['전체']`는 여기서 거르지 않는다 — `length === 0`만 본다. 다만 `'전체'`가
 * "전 장르 대상"이라는 뜻은 **아니다**: kosmart 응답 실측(2026-09-09, n=64)에서
 * `['전체']` 15건 중 14건이 융자·행정 안내·교육·심리상담처럼 장르 개념이 없는 공고였다.
 * 즉 `'전체'`는 "장르를 특정할 수 없음"이다. 그래서 개인 매칭
 * (`interestMatch.ts:matchesInterests`)은 `'전체'`를 통과시키지 않는다.
 */
export function isExcludedByGenres(genres: string[]): boolean {
  return genres.length === 0
}

/**
 * `biz_type`의 모든 값이 '교육'일 때만 제외한다.
 *
 * `biz_type`은 쉼표로 이어진 다중값이다(`'창작, 기타'`처럼). 조합원이 지원사업 안내에서
 * 기대하는 것은 창작지원·공모이지 교육 프로그램이 아니다(2026-W37 실측 16·17번:
 * 액셀러레이터 프로그램, 진로·취업 상담 수강생 모집). 다만 `'창작지원, 교육'`처럼
 * 창작이 함께 붙은 것은 남겨야 하므로 값 하나하나를 정확히 비교한다 —
 * `'예술교육'`은 `'교육'`과 다른 문자열이라 걸리지 않는다.
 *
 * `null`/빈 문자열이면 이 규칙은 적용하지 않는다(다른 규칙이 판단한다).
 */
export function isExcludedByBizType(bizType: string | null | undefined): boolean {
  if (!bizType) return false
  const values = bizType
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0)
  if (values.length === 0) return false
  return values.every(v => v === '교육')
}

/**
 * kosmart 응답의 카테고리로 생활정보성 공고를 거른다.
 *
 * kosmart의 partner 피드에는 자체 발송(`digest.ts`)이 쓰는 life 쿼터가 없다 — 실측
 * (2026-09-09, `genres=음악&regions=경기,서울&strictRegion=true`, n=64)으로 **64건 중
 * 37건(58%)이 life 계열**이었다(housing 28 · finance 6 · admin 2 · welfare 1).
 * 게시글은 풀 전체를 싣기 때문에, 여기서 거르지 않으면 조합 공식 게시물에 임대주택
 * 공고가 통째로 올라간다.
 *
 * 거르는 값은 운영 데이터에서 실제로 관찰된 것만 적는다. `grant_digests` 60건 실측
 * (2026-W36·W37)의 카테고리 분포는 `grant 32 · housing 19 · finance 6 · admin 2 ·
 * welfare 1`이었다.
 *
 * - `finance`는 뺀다. 「예술산업보증」처럼 예술 관련 금융이 섞여 있지만, 실제로는 전세자금·
 *   생활안정자금 융자가 대부분이라 조합원이 지원사업 메일에서 기대하는 내용이 아니다.
 *
 * 새 카테고리 값이 들어오면 이 목록은 그것을 모른다 — 값을 추가하기 전에 운영 데이터에서
 * 그 값이 실제로 오는지부터 확인한다.
 */
export function isExcludedByCategory(category: string): boolean {
  return EXCLUDED_CATEGORIES.has(category)
}

/** 카테고리 기반 제외 대상. {@link isExcludedByCategory} 참고 — `space`는 의도적으로 뺐다. */
const EXCLUDED_CATEGORIES = new Set(['housing', 'finance', 'welfare', 'admin'])

/**
 * 지역을 특정할 수 없는 공고를 거른다.
 *
 * kosmart 실측(2026-09-09): `effectiveOpportunityRegions`는 `regions=['전국']`일 때만
 * 제목으로 지역을 추론하고, `regions=[]`이면 추론에 도달하지 못한 채 "지역 무관"으로
 * 통과시킨다. 그래서 경기·서울로 좁혀 받은 요청에 「2026년 대구아트웨이 스튜디오
 * 입주예술인(단체) 공모」 같은 타지역 현장 공고가 `regions=[]`로 실려 온다.
 *
 * 빈 배열은 "전국"이 아니라 **분류 실패**다. 장르(`isExcludedByGenres`)와 같은 기준으로
 * 다룬다. 와일드카드 `'전국'`·`'전체'`가 붙은 공고는 여기서 걸리지 않는다.
 */
export function isExcludedByRegions(regions: string[]): boolean {
  return regions.length === 0
}

/**
 * 제목 기반 중복 제거 키.
 *
 * `key = source:source_id`만으로는 재공고를 못 잡는다 — 실측(2026-W36·W37)에서
 * 「2026년 양평문화자원 공연 창작프로젝트 공모」와 「2026년 양평문화자원 공연 창작
 * 프로젝트 공모 재공고」가 다른 `source_id`를 받아 게시글·메일·캘린더에 나란히 두 번
 * 실렸다(둘 다 마감 2026-11-02).
 *
 * 공백을 모두 지우고(띄어쓰기가 회차마다 다르다), '재공고'·'안내' 같은 꼬리말과
 * 괄호·문장부호를 지운 뒤 소문자로 맞춘다. 소스는 키에 넣지 않는다 — 같은 사업이
 * 다른 기관 페이지로 올라오는 경우도 같은 것으로 본다.
 */
export function normalizedTitleKey(title: string): string {
  return title
    .replace(/[[\]()<>{}·,.\-–—_'"`]/g, '')
    .replace(/재공고|공고안내|안내$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * 마감 오름차순. **마감이 없는 상시 공고는 맨 뒤**로 보낸다 — 날짜를 지어내 정렬에
 * 끼워 넣지 않는다. 마감이 같으면 원래 순서를 지킨다(안정 정렬).
 *
 * 메일이 `CAP`에서 잘릴 때 무엇이 잘리는지를 정하는 유일한 규칙이다. 정렬 없이 자르면
 * kosmart 점수순 배열의 꼬리가 잘리는데, 실측 W37의 마감 순서는
 * `11-02, 09-17, 09-23, 상시, 09-15, …`로 마감과 아무 상관이 없었다 — active가 CAP을
 * 넘는 주에는 D-2 공고가 게시글에는 있고 메일에는 없는 일이 생긴다.
 */
export function sortByDeadline<T extends { apply_end: string | null }>(items: T[]): T[] {
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ae = a.item.apply_end
      const be = b.item.apply_end
      if (ae === be || (!ae && !be)) return a.index - b.index
      if (!ae) return 1
      if (!be) return -1
      if (ae === be) return a.index - b.index
      return ae < be ? -1 : 1
    })
    .map(entry => entry.item)
}

/**
 * kosmart가 준 목록에서 최근 회차에 이미 담긴 것과 규칙상 제외 대상을 빼고 cap까지 남긴다.
 *
 * 중복 제거는 두 축이다: `key`(= `source:source_id`)와 {@link normalizedTitleKey}.
 * 후자가 없으면 재공고가 새 `source_id`를 달고 다시 들어온다 — 실측된 양평문화자원
 * 사례가 그것이다. `sentKeys`에 대해서도 같은 두 축을 본다.
 *
 * **순서를 다시 정렬하지 않는다** — 이미 `interleaveGenreBlocks`로 장르 간 공정한 순서가
 * 정해져 있거나(풀 생성 경로), kosmart가 `rankAndCap`으로 점수순·마감임박순으로 정렬해서
 * 보낸 순서 그대로다. 메일이 잘릴 때의 순서는 발행 시점에 `sortByDeadline`이 정한다.
 */
export function buildDraftItems(
  fetched: GrantItem[],
  sentKeys: Set<string>,
  cap: number = CAP,
  sentTitleKeys: Set<string> = new Set()
): GrantItem[] {
  const out: GrantItem[] = []
  const seen = new Set<string>()
  const seenTitles = new Set<string>()
  for (const it of fetched) {
    if (sentKeys.has(it.key)) continue
    if (seen.has(it.key)) continue // 같은 응답 안의 중복
    const titleKey = normalizedTitleKey(it.title)
    if (titleKey.length > 0 && (sentTitleKeys.has(titleKey) || seenTitles.has(titleKey))) continue
    if (isExcludedByTitle(it.title)) continue // cap을 세기 전에 걸러야 자리를 먹지 않는다
    if (isExcludedByCategory(it.category)) continue // 위와 같은 이유
    if (isExcludedByGenres(it.genres)) continue // 위와 같은 이유
    if (isExcludedByRegions(it.regions)) continue // 위와 같은 이유
    if (isExcludedByBizType(it.biz_type)) continue // 위와 같은 이유
    seen.add(it.key)
    if (titleKey.length > 0) seenTitles.add(titleKey)
    out.push(it)
    if (out.length >= cap) break
  }
  return out
}

/** 관리자가 제외하지 않은 항목만. */
export function activeItems(items: GrantItem[]): GrantItem[] {
  return items.filter(i => !i.excluded)
}

/**
 * 마감까지 남은 날. 마감이 없으면 `'상시'`다 — **날짜를 지어내지 않는다.**
 */
export function dDay(applyEnd: string | null, todayIso: string): string {
  if (!applyEnd) return '상시'
  const end = Date.parse(`${applyEnd}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  if (!Number.isFinite(end) || !Number.isFinite(today)) return '상시'
  const days = Math.round((end - today) / 86_400_000)
  if (days < 0) return '마감'
  if (days === 0) return 'D-day'
  return `D-${days}`
}

/**
 * 마크다운 제어문자를 막는다 — 대괄호·역슬래시(링크 문법 `[텍스트](url)`가 깨지지 않게),
 * `*`·`_`·백틱(외부 기관 텍스트에 섞여 들어와 의도치 않게 강조·코드로 서식화되지 않게).
 */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\[\]*_`])/g, '\\$1')
}

/** HTML 특수문자를 막는다. `src/lib/auth/email.ts:20`과 같은 목록. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function tagLine(it: GrantItem): string {
  const tags = [...it.regions, ...it.genres]
  if (it.biz_type) tags.push(it.biz_type)
  return tags.join(' · ')
}

/**
 * 게시글 본문(마크다운).
 *
 * 항목이 0건이어도 본문을 만든다 — 빈 문자열은 게시글로 만들 수 없고(`content` NOT NULL),
 * "이번 주는 없었다"는 것 자체가 조합원에게 정보다.
 */
export function renderDigestMarkdown(
  items: GrantItem[],
  weekKeyValue: string,
  todayIso: string
): string {
  const active = activeItems(items)
  const head = `${weekKeyValue} 기준 지원사업입니다.\n`

  if (active.length === 0) {
    return `${head}\n이번 주에 새로 안내할 공고가 없습니다.\n`
  }

  const body = active
    .map(it => {
      const lines = [
        `### [${escapeMarkdown(it.title)}](${it.url})`,
        '',
        `- 마감: ${dDay(it.apply_end, todayIso)}${it.apply_end ? ` (${it.apply_end})` : ''}`,
        `- 분류: ${escapeMarkdown(tagLine(it))}`,
      ]
      if (it.summary) lines.push(`- ${escapeMarkdown(it.summary)}`)
      return lines.join('\n')
    })
    .join('\n\n')

  const foot =
    '\n\n---\n\n' +
    '공고 정보는 각 기관 원문을 기준으로 합니다. 신청 전 원문에서 자격과 마감을 다시 확인해 주세요.\n'

  return `${head}\n${body}${foot}`
}

/**
 * 이메일 제목과 본문.
 *
 * `options.truncatedFrom`은 **자르기 전 건수**다. 담긴 건수보다 크면 본문에 몇 건이
 * 잘렸는지 한 줄을 넣는다 — 잘리지 않았으면 그 줄은 나오지 않는다. 이 문구가 없던
 * 시절에는 게시글 14건 · 알림 14건 · 메일 12건으로 숫자가 갈렸는데 어느 화면도 그
 * 사실을 말하지 않았다(2026-W37 실측).
 */
export function renderDigestEmail(
  items: GrantItem[],
  weekKeyValue: string,
  todayIso: string,
  settingsUrl: string,
  options: { truncatedFrom?: number } = {}
): { subject: string; html: string } {
  const active = activeItems(items)
  const subject = `[경기아트콜렉티브] 이번 주 예술지원사업 ${active.length}건`
  const safeSettings = escapeHtml(settingsUrl)

  const cards = active
    .map(
      it => `
  <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px">
    <a href="${escapeHtml(it.url)}" style="font-size: 15px; font-weight: 700; color: #1f2937; text-decoration: none">${escapeHtml(it.title)}</a>
    <p style="font-size: 12px; color: #6b7280; margin: 8px 0 0">${escapeHtml(dDay(it.apply_end, todayIso))}${it.apply_end ? ` · 마감 ${escapeHtml(it.apply_end)}` : ''} · ${escapeHtml(tagLine(it))}</p>
    ${it.summary ? `<p style="font-size: 13px; line-height: 1.6; color: #4b5563; margin: 8px 0 0">${escapeHtml(it.summary.slice(0, 140))}</p>` : ''}
  </div>`
    )
    .join('')

  const empty =
    '<p style="font-size: 14px; color: #4b5563">이번 주에 새로 안내할 공고가 없습니다.</p>'

  const truncatedFrom = options.truncatedFrom ?? active.length
  const truncatedNote =
    truncatedFrom > active.length
      ? `<p style="font-size: 13px; color: #b45309; margin: 0 0 16px">마감이 빠른 순으로 ${active.length}건만 담았습니다. 나머지 ${truncatedFrom - active.length}건은 게시판 &gt; 지원사업 글에서 볼 수 있습니다.</p>`
      : ''

  const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
  <h1 style="font-size: 20px; font-weight: 700; margin-bottom: 8px">이번 주 예술지원사업</h1>
  <p style="font-size: 13px; color: #6b7280; margin: 0 0 20px">${escapeHtml(weekKeyValue)}</p>
  ${truncatedNote}${active.length === 0 ? empty : cards}
  <p style="font-size: 12px; line-height: 1.6; color: #9ca3af; margin-top: 24px">
    공고 정보는 각 기관 원문을 기준으로 합니다. 신청 전 원문에서 자격과 마감을 다시 확인해 주세요.<br />
    이 메일을 받지 않으려면 <a href="${safeSettings}" style="color: #6b7280">마이페이지 &gt; 설정</a>에서 이메일 알림을 꺼 주세요.
  </p>
</div>`

  return { subject, html }
}

/** 인앱 알림 제목·본문. */
export function renderDigestNotification(
  items: GrantItem[],
  weekKeyValue: string
): { title: string; message: string } {
  const count = activeItems(items).length
  return {
    title: '이번 주 예술지원사업 안내',
    message:
      count === 0
        ? `${weekKeyValue} 지원사업 안내가 올라왔습니다.`
        : `지원사업 ${count}건이 올라왔습니다.`,
  }
}
