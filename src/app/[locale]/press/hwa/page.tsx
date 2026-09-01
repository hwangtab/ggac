import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import { PRESS_KO, PRESS_EN, TRACKS, STREAMING, ASSETS, LYRICS } from './content'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()
  return {
    title: isEn ? 'HWA — Debut EP Press Kit' : '화(HWA) 첫 EP 프레스킷',
    description: isEn
      ? 'Press kit for HWA, a grindcore band from Seoul. Debut EP out August 21, 2026 — 8 tracks, 10 minutes 30 seconds.'
      : '서울의 그라인드코어 밴드 화(HWA)의 첫 EP 프레스킷. 2026년 8월 21일 발매, 8트랙 10분 30초.',
    alternates: getLocaleAlternates('/press/hwa', locale),
    openGraph: {
      title: isEn ? 'HWA — Debut EP' : '화(HWA) 첫 EP',
      description: isEn
        ? 'Out August 21, 2026 · 8 tracks · 10:30'
        : '2026년 8월 21일 발매 · 8트랙 · 10분 30초',
      url: isEn ? `${base}/en/press/hwa` : `${base}/press/hwa`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      type: 'website',
      locale: getOgLocale(locale),
      images: [{ url: ASSETS.artwork, width: 1200, height: 1200, alt: 'HWA — HWA' }],
    },
    // 기자만 보는 페이지다. 검색 결과에 앨범 페이지 대신 이것이 뜨면 안 된다.
    robots: { index: false, follow: true },
  }
}

export default async function HwaPressPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const c = locale === 'en' ? PRESS_EN : PRESS_KO
  const isEn = locale === 'en'

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ASSETS.artwork}
        alt={`${c.title} artwork`}
        className="w-full rounded-lg border border-gray-200"
      />
      <h1 className="mt-8 text-3xl font-bold text-gray-900 sm:text-4xl">{c.title}</h1>
      <p className="mt-1 text-gray-600">{c.subtitle}</p>
      <p className="mt-1 text-gray-600">{c.releaseLine}</p>

      <blockquote className="my-8 border-l-4 border-gray-900 pl-4">
        <p className="text-xl italic leading-relaxed text-gray-900">&ldquo;{c.quote.text}&rdquo;</p>
        <cite className="mt-2 block text-sm not-italic text-gray-600">
          <a href={c.quote.url} className="underline" target="_blank" rel="noopener noreferrer">
            {c.quote.source}
          </a>
        </cite>
      </blockquote>

      {c.lede.map((p, i) => (
        <p key={i} className="mb-4 leading-relaxed text-gray-800">
          {p}
        </p>
      ))}

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">{c.bioHeading}</h2>
      {c.bio.map((p, i) => (
        <p key={i} className="mb-4 leading-relaxed text-gray-800">
          {p}
        </p>
      ))}

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">{c.factsHeading}</h2>
      <dl className="text-gray-800">
        {c.facts.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 border-b py-2 sm:flex-row sm:gap-3">
            <dt className="text-gray-500 sm:w-40 sm:shrink-0">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">{c.contactHeading}</h2>
      <p className="leading-relaxed text-gray-800">{c.contactBody}</p>

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">
        {isEn ? 'Downloads' : '다운로드'}
      </h2>
      <ul className="list-disc pl-6 text-gray-800">
        {c.downloads.map(d => (
          <li key={d.url} className="mb-1 break-words">
            <a href={d.url} className="underline">
              {d.label}
            </a>
            {d.note ? <span className="text-gray-600"> — {d.note}</span> : null}
          </li>
        ))}
      </ul>

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">
        {isEn ? 'Streaming' : '스트리밍'}
      </h2>
      <ul className="list-disc pl-6 text-gray-800">
        {STREAMING.map(([name, url]) => (
          <li key={url}>
            <a href={url} className="underline" target="_blank" rel="noopener noreferrer">
              {name}
            </a>
          </li>
        ))}
      </ul>

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">
        {isEn ? 'Tracklist' : '트랙리스트'}
      </h2>
      <ol className="text-gray-800">
        {TRACKS.map(t => (
          <li key={t.n} className="flex items-baseline justify-between gap-3 border-b py-1.5">
            <span className="min-w-0 truncate">
              {t.n}. {t.title}
            </span>
            <span className="shrink-0 text-gray-500">{t.length}</span>
          </li>
        ))}
      </ol>

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">
        {isEn ? 'Credits' : '크레딧'}
      </h2>
      <dl className="text-gray-800">
        {c.credits.map(([role, name]) => (
          <div key={role} className="flex flex-col gap-0.5 border-b py-2 sm:flex-row sm:gap-3">
            <dt className="text-gray-500 sm:w-48 sm:shrink-0">{role}</dt>
            <dd className="break-words">{name}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mb-3 mt-10 text-xl font-semibold text-gray-900">{c.lyricsHeading}</h2>
      {TRACKS.map(t => (
        <section key={t.n} className="mb-6">
          <h3 className="font-semibold text-gray-900">
            {t.n}. {t.title}
          </h3>
          <pre className="whitespace-pre-wrap break-words font-sans text-gray-800">
            {LYRICS[t.n]}
          </pre>
        </section>
      ))}
    </main>
  )
}
