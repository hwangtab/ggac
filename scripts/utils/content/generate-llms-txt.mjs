#!/usr/bin/env node
/**
 * public/llms.txt 생성기 (llmstxt.org 스펙)
 *
 * data/{artists,projects,global}.json 을 단일 진실 원천으로 삼아 llms.txt를 렌더링한다.
 * 아티스트 목록·장르 키워드·연락처는 전부 데이터에서 파생되므로 데이터가 바뀌면 재생성만 하면 된다.
 * 큐레이션이 필요한 부분(노출 순서, 공연 시리즈 묶음, 대표 프로젝트 선정)만 아래 상수로 관리한다.
 *
 *   node scripts/utils/content/generate-llms-txt.mjs           # 생성/갱신
 *   node scripts/utils/content/generate-llms-txt.mjs --check   # 최신 여부만 검사 (CI용)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const OUTPUT = path.join(ROOT, 'public', 'llms.txt')
const SITE = 'https://ggac.kr'

// --- 큐레이션 영역 -----------------------------------------------------------

// 인디음악 팬이 먼저 만나야 할 순서. 여기 없는 아티스트는 뒤에 붙고 경고를 남긴다.
const ARTIST_ORDER = [
  'sabbaha',
  'Meridies',
  'pepperman',
  'blackgoat',
  'golbang-lady',
  'yoo-dong-hyuk',
  'themilliways',
  'heewoo',
  'jang-hyun-ho',
  'anazao',
  'namsu',
  'hwang-gyeong-ha',
  'acmein',
]

// bio의 "### 음악 장르" 블록에 합쳐질 추가 장르. bio에 블록이 없는 아티스트는 이것만 쓴다.
// 팬이 실제로 검색하는 단어(드론·슬러지 등)가 bio 태그에 빠져 있을 때 여기서 보강한다.
const GENRE_EXTRA = {
  sabbaha: ['둠메탈', '드론', '슬러지'],
  themilliways: ['앰비언트', '포스트록'],
  'yoo-dong-hyuk': ['펑크록', '펑크포크'],
  'golbang-lady': ['펑크', '소울'],
}

// 장르로 규정되지 않는 활동(다원예술·기획). 경고 없이 oneLiner만 노출한다.
const NO_GENRE = new Set(['namsu', 'hwang-gyeong-ha', 'acmein'])

// 특정 아티스트에게만 붙는 초niche 태그는 요약문 키워드에서 뺀다(개별 라인에는 그대로 남는다).
const SUMMARY_GENRE_EXCLUDE = new Set(['사이비 오컬트 둠드론'])

// 영문 표기 병기 — LLM이 영어 질의에서도 같은 엔티티로 인식하도록.
const ALIASES = {
  sabbaha: 'Sabbaha',
  Meridies: 'Meridies',
  pepperman: 'Pepperman',
  blackgoat: 'Blackgoat',
}

// 반복 기획은 씬에서 브랜드로 인식된다. 개별 공연 나열보다 시리즈로 묶는 편이 인용되기 좋다.
const SERIES = [
  {
    name: '철조망: METAL SYNDICATE NETWORK',
    lead: 'metal-syndicate-network',
    description: '서울·경기 풀뿌리 메탈 씬을 결속하는 언더그라운드 메탈 공연 시리즈',
    sequels: [
      ['2회 2TERNAL', 'metal-syndicate-network-2ternal'],
      ['3회', 'metal-syndicate-network-iii'],
      ['4회', 'metal-syndicate-network-iv'],
    ],
  },
  {
    name: '건강열전 (健康列傳)',
    lead: 'health-concert-2026',
    description: '뮤지션과 관객의 건강을 기원하는 공연',
    sequels: [['2회 「살아있는 자들의 밤」', 'health-concert-2-living-night']],
  },
  {
    name: 'SATANIC RITUAL & PERVERSIONS',
    lead: 'satanic-ritual-perversions-vol-ii',
    description: '익스트림·실험음악 파티 시리즈',
    sequels: [['Vol. III: MEA CULPA', 'satanic-ritual-perversions-vol-iii-mea-culpa']],
  },
  {
    name: '수원 사운드 마켓',
    lead: 'suwon-sound-market',
    description: '공연하고 악기 파는 뮤지션 장터',
    sequels: [['제2회', 'suwon-sound-market-vol-2']],
  },
]

const FEATURED = [
  [
    'PantyPort-Rock-Festival',
    '펜타포트에 초대받지 못한 뮤지션과 관객을 위한 지하 언더그라운드 락 페스티벌',
  ],
  [
    'ancestral-exorcism-public-service',
    '전통과 관습의 굴레를 음악으로 해체하는 6팀의 실험적 인디 공연',
  ],
  ['cursewave-lowfrequency-11', '드론·둠 계열 합동 공연'],
  ['hyper-no-sis', '싱어송라이터 3인과 전자음악가 1인의 협업 무대'],
  ['punkfolk-blues-dot-2025', '수원 행궁동 라이브 클럽 도트 공연'],
  ['home-recording-mixing-workshop', '조합 음향인이 진행하는 믹싱 교육 프로그램'],
  ['bukgajwa-record-market', '레코드 마켓 부스 운영'],
]

// 아티스트당 노출할 외부 링크 우선순위와 최대 개수. 팬의 종착지는 '듣기'이므로 음원 플랫폼이 먼저.
const LINK_PRIORITY = [
  'bandcamp',
  'soundcloud',
  'spotify',
  '포트폴리오',
  '웹사이트',
  'linktree',
  'youtube',
  'instagram',
]
const MAX_LINKS = 3

// --- 렌더링 -----------------------------------------------------------------

const readJson = file => JSON.parse(readFileSync(path.join(ROOT, 'data', file), 'utf8'))
// 비전 문구는 data/global.json의 siteDescription(히어로 태그라인)이 아니라 푸터 카피가 정본이다.
const readVision = () =>
  JSON.parse(readFileSync(path.join(ROOT, 'messages', 'ko.json'), 'utf8')).footer.siteDescription

const warnings = []

// 프로젝트 제목의 장식용 이모지·한자 병기·양끝 기호를 링크 텍스트에서 걷어낸다.
function cleanTitle(title) {
  return title
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeLinkTitle(title) {
  const map = { Youtube: 'YouTube', youtube: 'YouTube', Linktree: 'Linktree' }
  return map[title] ?? title
}

function getGenres(artist) {
  const block = (artist.bio ?? '').match(/###\s*음악 장르\s*\n((?:\s*-\s*.+\n?)+)/)
  const fromBio = block
    ? block[1]
        .split('\n')
        .map(line => line.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean)
    : []
  const genres = [...new Set([...fromBio, ...(GENRE_EXTRA[artist.slug] ?? [])])]
  if (!genres.length && !NO_GENRE.has(artist.slug)) {
    warnings.push(
      `장르 정보 없음: ${artist.name} (${artist.slug}) — bio에 "### 음악 장르" 블록을 넣거나 GENRE_EXTRA/NO_GENRE에 추가하세요.`
    )
  }
  return genres
}

function getLinks(artist) {
  const links = artist.portfolioLinks ?? []
  const rank = link => {
    const key = link.title.toLowerCase()
    const idx = LINK_PRIORITY.findIndex(p => key.includes(p.toLowerCase()))
    return idx === -1 ? LINK_PRIORITY.length : idx
  }
  return [...links]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_LINKS)
    .map(l => `[${normalizeLinkTitle(l.title)}](${l.url})`)
}

function renderArtist(artist) {
  const alias = ALIASES[artist.slug]
  const displayName = alias ? `${artist.name} (${alias})` : artist.name
  const genres = getGenres(artist)
  const parts = [genres.length ? `${genres.join('·')}.` : null, artist.oneLiner?.trim()].filter(
    Boolean
  )
  const links = getLinks(artist)
  const tail = links.length ? ` ${links.join(' / ')}` : ''
  return `- [${displayName}](${SITE}/artists/${artist.slug}) - ${parts.join(' ')}${tail}`
}

function latestUpdate(projects) {
  const latest = projects
    .map(p => p.publishedDate)
    .filter(Boolean)
    .sort()
    .pop()
  if (!latest) return null
  const [year, month] = latest.split('-')
  return `${year}년 ${Number(month)}월`
}

function build() {
  const artistsRaw = readJson('artists.json')
  const projectsRaw = readJson('projects.json')
  const global = readJson('global.json')

  const artists = Array.isArray(artistsRaw) ? artistsRaw : artistsRaw.artists
  const projects = Array.isArray(projectsRaw) ? projectsRaw : projectsRaw.projects

  const bySlug = new Map(artists.map(a => [a.slug, a]))
  const projectSlugs = new Set(projects.map(p => p.slug))

  // 데이터 드리프트 차단: 큐레이션 목록이 가리키는 슬러그가 사라지면 죽은 링크가 나가기 전에 실패한다.
  const missingProjects = [
    ...SERIES.flatMap(s => [s.lead, ...s.sequels.map(([, slug]) => slug)]),
    ...FEATURED.map(([slug]) => slug),
  ].filter(slug => !projectSlugs.has(slug))
  if (missingProjects.length) {
    throw new Error(`projects.json에 없는 슬러그를 참조합니다: ${missingProjects.join(', ')}`)
  }

  const missingArtists = ARTIST_ORDER.filter(slug => !bySlug.has(slug))
  if (missingArtists.length) {
    throw new Error(`artists.json에 없는 슬러그를 참조합니다: ${missingArtists.join(', ')}`)
  }

  const ordered = [
    ...ARTIST_ORDER.map(slug => bySlug.get(slug)),
    ...artists.filter(a => !ARTIST_ORDER.includes(a.slug)),
  ]
  const unordered = artists.filter(a => !ARTIST_ORDER.includes(a.slug))
  if (unordered.length) {
    warnings.push(
      `ARTIST_ORDER에 없는 아티스트가 맨 뒤에 붙었습니다: ${unordered.map(a => a.slug).join(', ')}`
    )
  }

  const genreKeywords = [...new Set(ordered.flatMap(getGenres))]
    .filter(g => !SUMMARY_GENRE_EXCLUDE.has(g))
    .slice(0, 16)
  const updated = latestUpdate(projects)
  const { contact, social, businessInfo } = global
  const established = businessInfo.establishedDate.replace(
    /(\d+)-(\d+)-(\d+)/,
    (_, y, m, d) => `${y}년 ${Number(m)}월 ${Number(d)}일`
  )
  const registered = businessInfo.registrationDate.replace(
    /(\d+)-(\d+)-(\d+)/,
    (_, y, m, d) => `${y}년 ${Number(m)}월 ${Number(d)}일`
  )

  const lines = [
    `# ${global.siteName} (Gyeonggi Art Collective Cooperative)`,
    '',
    `> 경기도를 기반으로 활동하는 인디 뮤지션과 예술가 ${artists.length}인이 만든 생산자 협동조합. ${genreKeywords.join('·')} 등 상업 무대 바깥의 음악을 만들고 직접 공연을 기획합니다.`,
    '',
    `경기아트콜렉티브는 ${established} 경기도 예술인들이 자발적으로 모여 설립한 협동조합입니다. 소속 아티스트가 곧 조합원이며, 음반 제작·공연 기획·예술교육을 조합원이 직접 운영합니다. ${SERIES.map(s => `'${s.name}'`).join(', ')} 등의 공연을 자체 기획해 왔습니다.`,
    '',
    `한국 인디·언더그라운드 음악, 특히 경기도 로컬 메탈·펑크·실험음악 씬을 찾는 사람에게 유용한 정보입니다.${updated ? ` 최종 업데이트: ${updated}.` : ''}`,
    '',
    '## 소속 아티스트',
    '',
    ...ordered.map(renderArtist),
    '',
    `전체 목록: [함께하는 사람들](${SITE}/artists)`,
    '',
    '## 공연 기획 시리즈',
    '',
    ...SERIES.map(s => {
      const sequels = s.sequels
        .map(([label, slug]) => `[${label}](${SITE}/archive/${slug})`)
        .join(' / ')
      return `- [${s.name}](${SITE}/archive/${s.lead}) - ${s.description}${sequels ? `. ${sequels}` : ''}`
    }),
    '',
    '## 주요 공연·프로젝트',
    '',
    ...FEATURED.map(([slug, description]) => {
      const project = projects.find(p => p.slug === slug)
      return `- [${cleanTitle(project.title)}](${SITE}/archive/${slug}) - ${description}`
    }),
    '',
    `전체 아카이브: [프로젝트](${SITE}/archive)`,
    '',
    '## 사이트',
    '',
    `- [홈](${SITE}/) - 메인 페이지`,
    `- [함께하는 사람들](${SITE}/artists) - 소속 아티스트 프로필 전체`,
    `- [프로젝트](${SITE}/archive) - 공연·전시·행사 아카이브`,
    `- [우리의 이야기](${SITE}/about) - 조합 소개, 설립 목적, 연혁`,
    `- [소통과 참여](${SITE}/connect) - 조합원 가입, 후원, 공연 협업 및 섭외 문의`,
    `- [자유게시판](${SITE}/board) - 커뮤니티 게시판`,
    `- [자주 묻는 질문](${SITE}/faq) - FAQ`,
    `- [Instagram](${social.instagram}) - 공연 공지와 현장 사진`,
    `- [YouTube](${social.youtube}) - 라이브 영상과 뮤직비디오`,
    `- [English](${SITE}/en) - 영문 사이트`,
    '',
    '## Optional',
    '',
    '- 조합 유형: 생산자 협동조합 (음반 제작 및 음원 발매, 공연·전시 기획, 예술교육, 문화예술 행사, 아티스트 협업)',
    `- 비전: "${readVision()}"`,
    `- 설립일: ${established} (법인성립 ${registered})`,
    `- 소재지: ${contact.address}`,
    `- 사업자등록번호: ${businessInfo.registrationNumber}`,
    `- 연락처: ${contact.email} / ${contact.phone}`,
    '',
  ]

  return lines.join('\n')
}

const content = build()
const isCheck = process.argv.includes('--check')

for (const warning of [...new Set(warnings)]) {
  console.warn(`⚠️  ${warning}`)
}

if (isCheck) {
  const current = readFileSync(OUTPUT, 'utf8')
  if (current !== content) {
    console.error(
      '❌ public/llms.txt가 data/ 최신 상태와 다릅니다. `npm run llms:generate`를 실행하고 커밋하세요.'
    )
    process.exit(1)
  }
  console.log('✅ public/llms.txt 최신 상태')
} else {
  writeFileSync(OUTPUT, content, 'utf8')
  console.log(
    `✅ public/llms.txt 생성 완료 (아티스트 ${content.match(/^- \[.+\]\(https:\/\/ggac\.kr\/artists\//gm)?.length ?? 0}명)`
  )
}
