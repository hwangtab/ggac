import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  weekKey,
  buildDraftItems,
  interleaveGenreBlocks,
  activeItems,
  dDay,
  renderDigestMarkdown,
  renderDigestEmail,
  renderDigestNotification,
  isExcludedByTitle,
  EXCLUDE_TITLE_KEYWORDS,
  CAP,
  POOL_CAP,
} = await import('../../src/lib/server/grantDigest.ts')

function item(over = {}) {
  return {
    key: 'ncas:1',
    source: 'ncas',
    source_id: '1',
    title: '2026년 음악 창작지원',
    genres: ['음악'],
    regions: ['경기'],
    category: 'grant',
    apply_start: '2026-09-01',
    apply_end: '2026-10-15',
    url: 'https://example.test/1',
    summary: '경기도 음악인을 위한 창작지원금',
    biz_type: '창작지원',
    target: null,
    ...over,
  }
}

// ---------------------------------------------------------------- weekKey

test('weekKey는 KST 기준 ISO 주차를 준다', () => {
  // 2026-09-01은 화요일. 그 주 월요일은 2026-08-31.
  assert.equal(weekKey(new Date('2026-09-01T00:00:00+09:00')), '2026-W36')
})

test('weekKey는 UTC가 아니라 KST로 판정한다', () => {
  // 2026-09-06(일) 23:30 UTC = 2026-09-07(월) 08:30 KST → 다음 주차여야 한다.
  const utcSunday = new Date('2026-09-06T23:30:00Z')
  assert.equal(weekKey(utcSunday), '2026-W37')
})

test('weekKey는 연말 주차를 ISO 규칙으로 넘긴다', () => {
  // 2027-01-01은 금요일 → ISO 기준 2026-W53에 속한다.
  assert.equal(weekKey(new Date('2027-01-01T00:00:00+09:00')), '2026-W53')
})

// ---------------------------------------------------------------- buildDraftItems

test('이미 보낸 key를 제외한다', () => {
  const out = buildDraftItems(
    [item({ key: 'ncas:1' }), item({ key: 'ncas:2' })],
    new Set(['ncas:1'])
  )
  assert.deepEqual(
    out.map(i => i.key),
    ['ncas:2']
  )
})

test('전부 중복이면 빈 배열이다', () => {
  const out = buildDraftItems([item({ key: 'ncas:1' })], new Set(['ncas:1']))
  assert.deepEqual(out, [])
})

test('CAP까지만 남긴다', () => {
  const many = Array.from({ length: CAP + 5 }, (_, i) => item({ key: `ncas:${i}` }))
  assert.equal(buildDraftItems(many, new Set()).length, CAP)
})

test('buildDraftItems는 넘겨준 cap을 따른다 (POOL_CAP 용)', async () => {
  const { buildDraftItems, POOL_CAP } = await import('../../src/lib/server/grantDigest.ts')
  const many = Array.from({ length: POOL_CAP + 10 }, (_, i) => item({ key: `ncas:${i}` }))
  assert.equal(buildDraftItems(many, new Set(), POOL_CAP).length, POOL_CAP)
})

test('POOL_CAP은 CAP보다 크다 (풀이 메일 한 통보다 넓어야 한다)', async () => {
  const { CAP, POOL_CAP } = await import('../../src/lib/server/grantDigest.ts')
  assert.ok(POOL_CAP > CAP)
})

test('kosmart가 준 순서를 보존한다 (점수 정렬을 다시 하지 않는다)', () => {
  const out = buildDraftItems(
    [item({ key: 'a' }), item({ key: 'b' }), item({ key: 'c' })],
    new Set()
  )
  assert.deepEqual(
    out.map(i => i.key),
    ['a', 'b', 'c']
  )
})

// ---------------------------------------------------------------- interleaveGenreBlocks (F1)

test('블록이 하나뿐이면 순서가 그대로 보존되고 buildDraftItems가 상위 POOL_CAP건을 낸다 (회귀 방어)', () => {
  // 지금 조합원 전원이 관심사 미설정이라 unionInterests가 음악 하나만 요청한다 — 그때
  // grantFetch가 돌려주는 블록은 [[...]] 하나뿐이다. 이 경우 interleaveGenreBlocks는
  // 원래 순서를 정확히 그대로 유지해야 한다. 이게 깨지면 미설정 조합원에게 회귀다.
  const single = Array.from({ length: POOL_CAP + 10 }, (_, i) => item({ key: `ncas:${i}` }))
  const merged = interleaveGenreBlocks([single])
  assert.deepEqual(
    merged.map(i => i.key),
    single.map(i => i.key)
  )

  const out = buildDraftItems(merged, new Set(), POOL_CAP)
  assert.equal(out.length, POOL_CAP)
  assert.deepEqual(
    out.map(i => i.key),
    single.slice(0, POOL_CAP).map(i => i.key)
  )
})

test('두 블록을 한 건씩 번갈아 뽑는다', () => {
  const a = [item({ key: 'a1' }), item({ key: 'a2' })]
  const b = [item({ key: 'b1' }), item({ key: 'b2' })]
  const merged = interleaveGenreBlocks([a, b])
  assert.deepEqual(
    merged.map(i => i.key),
    ['a1', 'b1', 'a2', 'b2']
  )
})

test('첫 장르가 풀 상한을 넘게 많아도 둘째 장르 항목이 결과에 존재한다', () => {
  const music = Array.from({ length: POOL_CAP + 20 }, (_, i) => item({ key: `music:${i}` }))
  const visualArts = Array.from({ length: 5 }, (_, i) => item({ key: `visual:${i}` }))
  const merged = interleaveGenreBlocks([music, visualArts])
  const out = buildDraftItems(merged, new Set(), POOL_CAP)
  assert.equal(out.length, POOL_CAP)
  assert.ok(
    out.some(i => i.key.startsWith('visual:')),
    '둘째 장르(시각예술) 항목이 풀에 하나도 없다'
  )
})

test('한 장르가 적으면 남는 자리를 다른 장르가 채운다 (자리를 낭비하지 않는다)', () => {
  const small = Array.from({ length: 3 }, (_, i) => item({ key: `small:${i}` }))
  const large = Array.from({ length: POOL_CAP + 20 }, (_, i) => item({ key: `large:${i}` }))
  const merged = interleaveGenreBlocks([small, large])
  const out = buildDraftItems(merged, new Set(), POOL_CAP)
  assert.equal(out.length, POOL_CAP)
  // 짧은 장르(3건)는 전부 담기고, 나머지 자리는 큰 장르가 채운다.
  assert.equal(out.filter(i => i.key.startsWith('small:')).length, 3)
  assert.equal(out.filter(i => i.key.startsWith('large:')).length, POOL_CAP - 3)
})

test('빈 블록은 순환에서 빠진다', () => {
  const merged = interleaveGenreBlocks([[], [item({ key: 'x' })], []])
  assert.deepEqual(
    merged.map(i => i.key),
    ['x']
  )
})

test('블록이 전부 비었으면 빈 배열이다', () => {
  assert.deepEqual(interleaveGenreBlocks([[], []]), [])
  assert.deepEqual(interleaveGenreBlocks([]), [])
})

test('빈 입력은 빈 배열이다', () => {
  assert.deepEqual(buildDraftItems([], new Set()), [])
})

// ---------------------------------------------------------------- isExcludedByTitle / 제목 기반 제외 필터

test('EXCLUDE_TITLE_KEYWORDS는 정확히 둘이다 (합창, 단원)', () => {
  assert.deepEqual([...EXCLUDE_TITLE_KEYWORDS], ['합창', '단원'])
})

test('합창단 신규단원 모집 공고는 제외된다', () => {
  assert.equal(isExcludedByTitle('[공고] 2026년 하반기 종로구립합창단 신규단원 모집'), true)
})

test('합창단 지도단원 모집 재공고는 제외된다', () => {
  assert.equal(
    isExcludedByTitle('2026년 종로구립어르신합창단 지도단원(알토) 모집 재공고 안내'),
    true
  )
})

test('무용·합창 워크숍 참여자 모집은 제외된다', () => {
  assert.equal(
    isExcludedByTitle('2026년 생활예술 마스터클래스 역량강화 워크숍 참여자 모집(무용, 합창)'),
    true
  )
})

test('연극·무용·음악·전통 통합공모는 제외되지 않는다 (오차단 방어)', () => {
  assert.equal(
    isExcludedByTitle('2027년 서울 커넥트 스테이지(연극·무용·음악·전통) 통합공모 안내'),
    false
  )
})

test('참여단체 모집은 제외되지 않는다 (단체와 단원 구분)', () => {
  assert.equal(isExcludedByTitle('서울문화재단 대학로센터 <제철공연> 참여단체 모집'), false)
})

test('음악 태그만 있는 일반 공고는 제외되지 않는다', () => {
  assert.equal(isExcludedByTitle('2027 서울 커넥트 스테이지-음악'), false)
})

test('buildDraftItems는 제외 대상 항목을 담지 않는다', () => {
  const out = buildDraftItems(
    [
      item({ key: 'a', title: '[공고] 종로구립합창단 신규단원 모집' }),
      item({ key: 'b', title: '2026년 음악 창작지원' }),
    ],
    new Set()
  )
  assert.deepEqual(
    out.map(i => i.key),
    ['b']
  )
})

test('buildDraftItems는 제외된 자리를 다음 항목으로 채운다 (cap을 채운다)', () => {
  const many = [
    item({ key: 'ex1', title: '종로구립합창단 신규단원 모집' }),
    item({ key: 'ex2', title: '시립교향악단 상임단원 모집 공고' }),
    ...Array.from({ length: CAP }, (_, i) => item({ key: `ok:${i}` })),
  ]
  const out = buildDraftItems(many, new Set())
  assert.equal(out.length, CAP)
  assert.ok(out.every(i => i.key.startsWith('ok:')))
})

// ---------------------------------------------------------------- activeItems

test('activeItems는 excluded를 뺀다', () => {
  const out = activeItems([item({ key: 'a' }), item({ key: 'b', excluded: true })])
  assert.deepEqual(
    out.map(i => i.key),
    ['a']
  )
})

// ---------------------------------------------------------------- dDay

test('dDay는 남은 날짜를 센다', () => {
  assert.equal(dDay('2026-09-10', '2026-09-01'), 'D-9')
})

test('dDay는 당일을 D-day로 부른다', () => {
  assert.equal(dDay('2026-09-01', '2026-09-01'), 'D-day')
})

test('dDay는 마감 없음을 상시로 부른다 (날짜를 지어내지 않는다)', () => {
  assert.equal(dDay(null, '2026-09-01'), '상시')
})

// ---------------------------------------------------------------- 마크다운

test('마크다운에 제목·링크·마감이 들어간다', () => {
  const md = renderDigestMarkdown([item()], '2026-W36', '2026-09-01')
  assert.ok(md.includes('2026년 음악 창작지원'))
  assert.ok(md.includes('https://example.test/1'))
  assert.ok(md.includes('D-44'))
})

test('마크다운은 제목의 대괄호를 이스케이프한다 (링크가 깨지지 않게)', () => {
  const md = renderDigestMarkdown([item({ title: '[공고] 지원 [1차]' })], '2026-W36', '2026-09-01')
  assert.ok(md.includes('\\[공고\\] 지원 \\[1차\\]'))
})

test('마크다운은 excluded 항목을 담지 않는다', () => {
  const md = renderDigestMarkdown(
    [
      item({ key: 'a', title: '남는 공고' }),
      item({ key: 'b', title: '빠진 공고', excluded: true }),
    ],
    '2026-W36',
    '2026-09-01'
  )
  assert.ok(md.includes('남는 공고'))
  assert.ok(!md.includes('빠진 공고'))
})

test('빈 목록도 본문을 만든다 (빈 문자열을 게시글로 만들지 않는다)', () => {
  const md = renderDigestMarkdown([], '2026-W36', '2026-09-01')
  assert.ok(md.length > 0)
  assert.ok(md.includes('없습니다'))
})

test('마크다운은 summary의 제어문자를 이스케이프한다 (외부 기관 텍스트가 서식을 깨지 않게)', () => {
  const md = renderDigestMarkdown(
    [item({ summary: '요약에 *강조*와 `코드`, [링크처럼](보이는) 것이 있다' })],
    '2026-W36',
    '2026-09-01'
  )
  assert.ok(md.includes('\\*강조\\*'))
  assert.ok(md.includes('\\`코드\\`'))
  assert.ok(md.includes('\\[링크처럼\\]'))
  assert.ok(!md.includes('*강조*'))
})

test('마크다운은 분류(tagLine)의 제어문자를 biz_type 경유로 이스케이프한다', () => {
  const md = renderDigestMarkdown([item({ biz_type: '*중요* 지원' })], '2026-W36', '2026-09-01')
  assert.ok(md.includes('\\*중요\\* 지원'))
  assert.ok(!md.includes('- 분류: 경기 · 음악 · *중요* 지원'))
})

// ---------------------------------------------------------------- 이메일

test('이메일 제목에 건수가 들어간다', () => {
  const { subject } = renderDigestEmail([item()], '2026-W36', '2026-09-01', 'https://x.test/s')
  assert.ok(subject.includes('1건'))
})

test('이메일 HTML은 제목의 특수문자를 이스케이프한다', () => {
  const { html } = renderDigestEmail(
    [item({ title: '<script>alert(1)</script> & 지원' })],
    '2026-W36',
    '2026-09-01',
    'https://x.test/s'
  )
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&amp; 지원'))
})

test('이메일 HTML에 수신 설정 링크가 들어간다', () => {
  const { html } = renderDigestEmail([item()], '2026-W36', '2026-09-01', 'https://x.test/settings')
  assert.ok(html.includes('https://x.test/settings'))
})

test('이메일 HTML은 url 속성도 이스케이프한다', () => {
  const { html } = renderDigestEmail(
    [item({ url: 'https://x.test/?a=1&b="2"' })],
    '2026-W36',
    '2026-09-01',
    'https://x.test/s'
  )
  assert.ok(!html.includes('b="2"'))
  assert.ok(html.includes('&amp;b=&quot;2&quot;'))
})

// ---------------------------------------------------------------- 알림

test('알림 제목·본문에 건수가 들어간다', () => {
  const n = renderDigestNotification([item(), item({ key: 'ncas:2' })], '2026-W36')
  assert.ok(n.title.length > 0)
  assert.ok(n.message.includes('2건'))
})
