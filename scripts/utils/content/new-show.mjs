#!/usr/bin/env node
/**
 * 공연·행사 스캐폴드 — data/projects.json(+en)에 SEO 필수 필드를 갖춘 항목을 추가한다.
 *
 *   npm run new:show
 *
 * 콘텐츠 플라이휠 부품 3. eventDate·venue·category·hostedByGgac 같은 구조화 필드를
 * 빠뜨리지 않게 프롬프트로 채운다 — 이 값들이 MusicEvent 스키마·예정공연 노출·자동
 * 리드(수동 lead 없을 때)의 입력이 된다. 사전 등록(미래 eventDate)이면 자동으로
 * '예정 공연'에 노출되고 이벤트 리치결과 자격을 얻는다.
 *
 * 채우고 남는 것: coverImage(포스터)·description(본문)·ticketing은 이후 직접 편집.
 * lead는 비워두면 필드에서 자동 생성되며, 원하면 나중에 손으로 덮어쓴다.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const KO_PATH = path.join(ROOT, 'data', 'projects.json')
const EN_PATH = path.join(ROOT, 'data', 'en', 'projects.json')

const CATEGORY = {
  '1': { ko: '공연·전시', en: 'Performance & Exhibition' },
  '2': { ko: '행사', en: 'Event' },
}

// async 이터레이터 기반 입력 — TTY(대화형)·파이프(스크립트/CI) 모두 안정 동작.
// readline/promises의 question()은 Node 24에서 파이프 입력의 2번째 질문부터 hang된다.
const rl = createInterface({ input, terminal: false })
const lines = rl[Symbol.asyncIterator]()
const ask = async (q, def = '') => {
  output.write(def ? `${q} [${def}]: ` : `${q}: `)
  const { value, done } = await lines.next()
  if (done) return def
  return (value ?? '').trim() || def
}
const askYesNo = async (q, def = 'n') => {
  const a = (await ask(`${q} (y/n)`, def)).toLowerCase()
  return a === 'y' || a === 'yes'
}

function nextId(list) {
  const max = list.reduce((m, p) => {
    const n = /project-(\d+)/.exec(p.id || '')
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `project-${String(max + 1).padStart(3, '0')}`
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function main() {
  const ko = JSON.parse(readFileSync(KO_PATH, 'utf8'))
  const en = existsSync(EN_PATH) ? JSON.parse(readFileSync(EN_PATH, 'utf8')) : ko

  console.log('\n🎸 새 공연·행사 추가 (SEO 필드 스캐폴드)\n')

  const titleKo = await ask('제목(한글)')
  if (!titleKo) {
    console.error('제목은 필수입니다. 중단.')
    rl.close()
    process.exit(1)
  }
  const titleEn = await ask('제목(영문)', titleKo)
  const slug = slugify(await ask('slug', slugify(titleEn)))
  if (ko.some(p => p.slug === slug)) {
    console.error(`이미 존재하는 slug: ${slug}. 중단.`)
    rl.close()
    process.exit(1)
  }

  console.log('카테고리: 1) 공연·전시   2) 행사')
  const catKey = (await ask('선택', '1')) === '2' ? '2' : '1'
  const category = CATEGORY[catKey]

  const today = new Date().toISOString().slice(0, 10)
  const publishedDate = await ask('발행일(공지일) YYYY-MM-DD', today)

  let eventDate = ''
  let venue = null
  let hostedByGgac = false
  if (catKey === '1') {
    eventDate = await ask('공연일 YYYY-MM-DD (없으면 빈칸)')
    const venueName = await ask('공연장 이름 (없으면 빈칸)')
    if (venueName) {
      const venueAddr = await ask('공연장 주소 (없으면 빈칸)')
      venue = venueAddr ? { name: venueName, address: venueAddr } : { name: venueName }
    }
    hostedByGgac = await askYesNo('경기아트콜렉티브 기획 공연인가?', 'y')
  }

  // 키 순서: 렌더·스키마가 기대하는 형태에 맞춰 구성. description/coverImage는 이후 채움.
  const koEntry = {
    id: nextId(ko),
    slug,
    title: titleKo,
    category: category.ko,
    publishedDate,
    ...(eventDate ? { eventDate } : {}),
    ...(venue ? { venue } : {}),
    ...(catKey === '1' && hostedByGgac ? { hostedByGgac: true } : {}),
    coverImage: '',
    description: '',
    gallery: [],
    videoUrl: null,
    artistIds: [],
    relatedArticles: [],
  }
  const enEntry = { ...koEntry, title: titleEn, category: category.en }

  ko.push(koEntry)
  en.push(enEntry)
  writeFileSync(KO_PATH, JSON.stringify(ko, null, 2) + '\n', 'utf8')
  writeFileSync(EN_PATH, JSON.stringify(en, null, 2) + '\n', 'utf8')

  rl.close()
  console.log(`\n✅ 추가됨: ${koEntry.id} (${slug})`)
  console.log('   ko:', KO_PATH)
  console.log('   en:', EN_PATH)
  console.log('\n남은 작업:')
  console.log('  1. coverImage — 포스터 이미지 경로 (예: /images/projects/xxx.webp)')
  console.log('  2. description — 본문 (마크다운). ko/en 각각')
  console.log('  3. artistIds — 참여 조합 아티스트 id (선택, performer로 연결됨)')
  console.log('  4. ticketing — 예매 정보 (선택)')
  console.log('  5. lead — 비워두면 필드에서 자동 생성. 손으로 덮어쓰려면 추가')
  console.log('\n  포맷 정리: npx prettier --write data/projects.json data/en/projects.json')
  if (eventDate && eventDate >= today) {
    console.log(`\n  🔔 미래 공연일(${eventDate}) — 배포되면 /archive '예정 공연'에 자동 노출됩니다.`)
  }
}

main().catch(err => {
  console.error(err)
  rl.close()
  process.exit(1)
})
