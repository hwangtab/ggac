type PageHeroProps = {
  /** 상단 킥커 — 홈 히어로·섹션 킥커와 같은 문법(대문자 + 넓은 자간) */
  kicker: string
  titleLine1: string
  /** 두 줄 제목일 때만. 한 줄이면 생략한다. */
  titleLine2?: string
  subtitle?: string
}

/**
 * 하위 페이지 공통 히어로.
 *
 * 이전에는 네 페이지가 각각 `bg-gradient-to-br from-primary-50 to-accent-50`
 * 위에 가운데 정렬된 h1을 얹고 있었다. 다크 테마에서 `from-*`/`to-*`는
 * 재매핑 대상이 아니라 배경이 통째로 사라지고, 가운데 정렬된 60px 제목만
 * 검은 여백 안에 떠 있었다. 홈 히어로는 왼쪽 정렬 900 웨이트인데 나머지
 * 페이지는 가운데 정렬 700 웨이트라 같은 사이트로 읽히지도 않았다.
 *
 * 여기서는 홈과 같은 문법을 쓴다: 킥커 행 → 헤어라인 → 큰 왼쪽 정렬 제목 →
 * 부제. 배경은 페이지 배경(#08080a)을 그대로 쓰고 아래쪽 헤어라인으로
 * 다음 섹션과 경계를 만든다.
 */
export default function PageHero({ kicker, titleLine1, titleLine2, subtitle }: PageHeroProps) {
  // 홈 히어로와 같은 방식으로 가장 긴 줄에 맞춰 크기를 잡는다. 줄이 길수록
  // 작아져야 좁은 화면에서 넘치지 않는다.
  const longest = Math.max(titleLine1.length, titleLine2?.length ?? 0, 1)
  const fontSize = `clamp(2rem, min(7.5vw, ${(110 / longest).toFixed(2)}vw), 4.5rem)`

  return (
    <section className="border-b border-white/15 pb-12 pt-10 text-white md:pb-16 md:pt-14">
      <div className="tw-container-custom">
        <div className="flex items-center gap-3 sm:gap-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/65">
            {kicker}
          </p>
          <span aria-hidden="true" className="h-px flex-1 bg-white/25" />
        </div>

        <h1
          className="mt-6 font-post font-black leading-[0.94] tracking-[-0.04em] text-white"
          style={{ fontSize }}
        >
          {titleLine1}
          {titleLine2 ? (
            <>
              <br />
              {titleLine2}
            </>
          ) : null}
        </h1>

        {subtitle ? (
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-white/70 sm:text-base">
            {subtitle}
          </p>
        ) : null}
      </div>
    </section>
  )
}
