// 사용: node scripts/perf/psi-measure.mjs <url> <mobile|desktop> [--lighthouse]
// 출력: JSON { url, strategy, source, score, metrics:{LCP,CLS,TBT,FCP,SI,TTFB}, opportunities:[{id,title,savingsMs}] }
//
// 기본 동작: PageSpeed Insights REST v5 호출. API 키는 process.env.PSI_API_KEY 있으면 사용.
// PSI가 실패(429 rate limit 등)하면 자동으로 로컬 lighthouse(npx)로 폴백.
// --lighthouse 플래그를 주면 PSI를 건너뛰고 곧바로 로컬 lighthouse를 실행.
// PSI lhr과 lighthouse lhr은 동일 구조라 extractMetrics를 그대로 재사용한다.
// before/after 재현성을 위해 두 소스 모두 같은 지표를 뽑고 source 필드로 구분한다.
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export function extractMetrics(lhr) {
  const a = lhr.audits ?? {}
  const num = id => a[id]?.numericValue ?? null
  const score = Math.round((lhr.categories?.performance?.score ?? 0) * 100)
  const opportunities = Object.values(a)
    .filter(x => x?.details?.type === 'opportunity' && (x.details.overallSavingsMs ?? 0) > 0)
    .map(x => ({ id: x.id, title: x.title, savingsMs: Math.round(x.details.overallSavingsMs) }))
    .sort((p, q) => q.savingsMs - p.savingsMs)
  return {
    score,
    metrics: {
      LCP: num('largest-contentful-paint'),
      CLS: a['cumulative-layout-shift']?.numericValue ?? null,
      TBT: num('total-blocking-time'),
      FCP: num('first-contentful-paint'),
      SI: num('speed-index'),
      TTFB: num('server-response-time'),
    },
    opportunities,
  }
}

// PSI REST 호출. 성공 시 lhr 반환, 실패 시 예외.
async function runPsi(url, strategy) {
  const key = process.env.PSI_API_KEY ? `&key=${process.env.PSI_API_KEY}` : ''
  const q = `${PSI}?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance${key}`
  const res = await fetch(q)
  if (!res.ok) throw new Error(`PSI HTTP ${res.status}`)
  const json = await res.json()
  if (!json.lighthouseResult) throw new Error('PSI 응답에 lighthouseResult 없음')
  return json.lighthouseResult
}

// 로컬 lighthouse(npx) 실행. desktop이면 --preset=desktop. lhr 반환.
function runLighthouse(url, strategy) {
  const out = join(tmpdir(), `lh-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  const args = [
    '--yes', 'lighthouse', url,
    '--only-categories=performance', '--output=json', '--quiet',
    `--output-path=${out}`,
    '--chrome-flags=--headless=new --no-sandbox',
  ]
  if (strategy === 'desktop') args.push('--preset=desktop')
  try {
    execFileSync('npx', args, { stdio: 'ignore', timeout: 180000 })
    return JSON.parse(readFileSync(out, 'utf8'))
  } finally {
    try { rmSync(out, { force: true }) } catch {}
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const forceLh = argv.includes('--lighthouse')
  const [url, strategy = 'mobile'] = argv.filter(x => !x.startsWith('--'))
  if (!url) { console.error('usage: psi-measure.mjs <url> <mobile|desktop> [--lighthouse]'); process.exit(1) }

  let lhr, source
  if (forceLh) {
    lhr = runLighthouse(url, strategy)
    source = 'lighthouse'
  } else {
    try {
      lhr = await runPsi(url, strategy)
      source = 'psi'
    } catch (e) {
      console.error(`PSI 실패(${e.message}) → 로컬 lighthouse 폴백: ${url} ${strategy}`)
      lhr = runLighthouse(url, strategy)
      source = 'lighthouse'
    }
  }
  const out = { url, strategy, source, ...extractMetrics(lhr) }
  console.log(JSON.stringify(out, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
