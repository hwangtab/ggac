import { test } from 'node:test'
import assert from 'node:assert/strict'

const { STANDARD_GENRES, REGIONS, isStandardGenre, isRegion } = await import(
  '../../src/constants/interests.ts'
)
const {
  effectiveInterests,
  matchesInterests,
  unionInterests,
  filterByDefaultInterests,
  DEFAULT_DIGEST_INTERESTS,
} = await import('../../src/lib/server/interestMatch.ts')

// ---------------------------------------------------------------- 상수

test('장르 10종이고 음악이 들어 있다', () => {
  assert.equal(STANDARD_GENRES.length, 10)
  assert.ok(STANDARD_GENRES.includes('음악'))
  assert.ok(STANDARD_GENRES.includes('시각예술'))
  assert.ok(STANDARD_GENRES.includes('다원예술'))
})

test('장르 목록에 전체가 들어 있지 않다', () => {
  // '전체'는 공고에만 붙는 값이고 "장르 특정 불가"를 뜻한다. 조합원이 고를 값이 아니다.
  assert.ok(!STANDARD_GENRES.includes('전체'))
})

test('지역 17종이고 경기·서울이 들어 있다', () => {
  assert.equal(REGIONS.length, 17)
  assert.ok(REGIONS.includes('경기'))
  assert.ok(REGIONS.includes('서울'))
  assert.ok(!REGIONS.includes('전국'))
})

test('isStandardGenre / isRegion 이 임의 문자열을 거부한다', () => {
  assert.equal(isStandardGenre('음악'), true)
  assert.equal(isStandardGenre('둠메탈'), false)
  assert.equal(isStandardGenre(''), false)
  assert.equal(isStandardGenre(123), false)
  assert.equal(isRegion('경기'), true)
  assert.equal(isRegion('전국'), false)
  assert.equal(isRegion(null), false)
})

// ---------------------------------------------------------------- effectiveInterests

test('미설정이면 조합 기본값을 쓴다', () => {
  const i = effectiveInterests({ interest_genres: [], interest_regions: [] })
  assert.deepEqual(i.genres, ['음악'])
  assert.deepEqual(i.regions, ['경기', '서울'])
})

test('null·undefined 도 미설정으로 본다', () => {
  assert.deepEqual(effectiveInterests({}).genres, ['음악'])
  assert.deepEqual(effectiveInterests({ interest_genres: null }).genres, ['음악'])
})

test('설정했으면 그 값을 쓴다 (기본값과 합치지 않는다)', () => {
  const i = effectiveInterests({ interest_genres: ['시각예술'], interest_regions: ['부산'] })
  assert.deepEqual(i.genres, ['시각예술'])
  assert.deepEqual(i.regions, ['부산'])
})

test('한 축만 설정하면 다른 축은 기본값이다', () => {
  const i = effectiveInterests({ interest_genres: ['무용'], interest_regions: [] })
  assert.deepEqual(i.genres, ['무용'])
  assert.deepEqual(i.regions, ['경기', '서울'])
})

// ---------------------------------------------------------------- matchesInterests

const MINE = { genres: ['음악'], regions: ['경기', '서울'] }

test('장르와 지역이 둘 다 맞으면 통과', () => {
  assert.equal(matchesInterests({ genres: ['음악'], regions: ['경기'] }, MINE), true)
})

test('장르가 맞아도 지역이 다르면 탈락 (BB7을 가져오지 않는다)', () => {
  assert.equal(matchesInterests({ genres: ['음악'], regions: ['부산'] }, MINE), false)
})

test('지역이 맞아도 장르가 다르면 탈락', () => {
  assert.equal(matchesInterests({ genres: ['무용'], regions: ['경기'] }, MINE), false)
})

test("공고 장르가 '전체'면 탈락한다 ('전체'는 전 장르가 아니라 분류 실패다)", () => {
  // kosmart 실측(2026-09-09, n=64): ['전체'] 15건 중 14건이 융자·행정 안내·교육·심리상담.
  assert.equal(matchesInterests({ genres: ['전체'], regions: ['서울'] }, MINE), false)
})

test("공고 지역이 '전국'이면 지역 축을 통과한다", () => {
  assert.equal(matchesInterests({ genres: ['음악'], regions: ['전국'] }, MINE), true)
})

test("공고 지역이 '전체'여도 지역 축을 통과한다", () => {
  assert.equal(matchesInterests({ genres: ['음악'], regions: ['전체'] }, MINE), true)
})

test('공고 지역 태그가 비면 탈락한다 (빈 배열은 전국이 아니라 분류 실패다)', () => {
  // 실측: 「2026년 대구아트웨이 스튜디오 입주예술인(단체) 공모」가 regions=[]로 실려
  // 경기·서울 요청을 그대로 통과했다. kosmart는 regions=[]에 제목 기반 지역 추론조차
  // 적용하지 않는다.
  assert.equal(matchesInterests({ genres: ['음악'], regions: [] }, MINE), false)
})

test('실데이터 형태: 관심사 미설정 회원(빈 배열)은 조합 기본값으로 판정된다', () => {
  const i = effectiveInterests({ interest_genres: [], interest_regions: [] })
  assert.equal(matchesInterests({ genres: ['음악'], regions: ['경기'] }, i), true)
  assert.equal(matchesInterests({ genres: ['전체'], regions: [] }, i), false)
})

// ------------------------------------------------- 게시글·알림은 조합 기본값만 (H8)

test('filterByDefaultInterests는 조합 기본 관심사 통과분만 남긴다', () => {
  const items = [
    { key: 'a', genres: ['음악'], regions: ['경기'] },
    { key: 'b', genres: ['문학'], regions: ['제주'] }, // 한 조합원이 켠 관심사로 딸려 온 것
    { key: 'c', genres: ['음악'], regions: ['전국'] },
  ]
  assert.deepEqual(
    filterByDefaultInterests(items).map(i => i.key),
    ['a', 'c']
  )
})

test('DEFAULT_DIGEST_INTERESTS는 조합 기본값(음악 / 경기·서울)이다', () => {
  assert.deepEqual(DEFAULT_DIGEST_INTERESTS.genres, ['음악'])
  assert.deepEqual(DEFAULT_DIGEST_INTERESTS.regions, ['경기', '서울'])
})

test('공고 장르 태그가 비면 탈락한다 (지역만으로 통과시키지 않는다)', () => {
  assert.equal(matchesInterests({ genres: [], regions: ['경기'] }, MINE), false)
})

test('여러 장르 중 하나만 겹쳐도 통과', () => {
  assert.equal(matchesInterests({ genres: ['연극', '음악'], regions: ['경기'] }, MINE), true)
})

// ---------------------------------------------------------------- unionInterests

test('합집합에 조합 기본값이 항상 포함된다', () => {
  const u = unionInterests([])
  assert.deepEqual([...u.genres].sort(), ['음악'])
  assert.deepEqual([...u.regions].sort(), ['경기', '서울'])
})

test('회원 설정이 합집합에 더해진다', () => {
  const u = unionInterests([
    { interest_genres: ['시각예술'], interest_regions: ['부산'] },
    { interest_genres: ['무용'], interest_regions: [] },
  ])
  assert.deepEqual([...u.genres].sort(), ['무용', '시각예술', '음악'].sort())
  assert.deepEqual([...u.regions].sort(), ['경기', '부산', '서울'].sort())
})

test('합집합에 중복이 없다', () => {
  const u = unionInterests([
    { interest_genres: ['음악'], interest_regions: ['경기'] },
    { interest_genres: ['음악'], interest_regions: ['경기'] },
  ])
  assert.deepEqual(u.genres, ['음악'])
  assert.deepEqual([...u.regions].sort(), ['경기', '서울'])
})

test('합집합이 알 수 없는 값을 걸러낸다', () => {
  // 설정 화면이 막지만, 옛 데이터나 손으로 넣은 행이 있을 수 있다.
  // 무의미한 값을 kosmart 요청에 실으면 그 호출은 0건을 돌려주고 조용히 아무 일도 안 난다.
  const u = unionInterests([{ interest_genres: ['둠메탈'], interest_regions: ['화성'] }])
  assert.deepEqual(u.genres, ['음악'])
  assert.deepEqual([...u.regions].sort(), ['경기', '서울'])
})
