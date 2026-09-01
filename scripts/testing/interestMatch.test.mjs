import { test } from 'node:test'
import assert from 'node:assert/strict'

const { STANDARD_GENRES, REGIONS, isStandardGenre, isRegion } = await import(
  '../../src/constants/interests.ts'
)
const { effectiveInterests, matchesInterests, unionInterests } = await import(
  '../../src/lib/server/interestMatch.ts'
)

// ---------------------------------------------------------------- 상수

test('장르 10종이고 음악이 들어 있다', () => {
  assert.equal(STANDARD_GENRES.length, 10)
  assert.ok(STANDARD_GENRES.includes('음악'))
  assert.ok(STANDARD_GENRES.includes('시각예술'))
  assert.ok(STANDARD_GENRES.includes('다원예술'))
})

test('장르 목록에 와일드카드 전체가 들어 있지 않다', () => {
  // '전체'는 공고에만 붙는 와일드카드다. 조합원이 고를 값이 아니다.
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

test("공고 장르가 '전체'면 장르 축을 통과한다", () => {
  assert.equal(matchesInterests({ genres: ['전체'], regions: ['서울'] }, MINE), true)
})

test("공고 지역이 '전국'이면 지역 축을 통과한다", () => {
  assert.equal(matchesInterests({ genres: ['음악'], regions: ['전국'] }, MINE), true)
})

test("공고 지역이 '전체'여도 지역 축을 통과한다", () => {
  assert.equal(matchesInterests({ genres: ['음악'], regions: ['전체'] }, MINE), true)
})

test('공고 지역 태그가 비면 전국으로 보고 통과한다', () => {
  assert.equal(matchesInterests({ genres: ['음악'], regions: [] }, MINE), true)
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
