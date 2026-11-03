import { highlightSegments } from '@work/lib/search/text'

/** 검색어 일치 구간을 <mark> 로 감싼다. 문자열을 구간으로 나눠 요소로 그리므로 raw HTML 이 없다. */
export default function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="rounded-w-lg bg-highlight px-0.5 font-semibold text-highlight-foreground"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  )
}
