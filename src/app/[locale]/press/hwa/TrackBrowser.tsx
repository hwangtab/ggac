'use client'

import { useEffect, useRef, useState } from 'react'
import { TRACKS, LYRICS, trackAudioUrl } from './content'

/**
 * 기자가 페이지를 떠나지 않고 전곡을 듣고, 듣는 곡의 가사를 함께 읽게 한다.
 *
 * 이 EP는 여덟 곡 10분 30초라 골라 듣기보다 한 번에 통과하는 물건이고,
 * 그래서 곡이 끝나면 다음 곡으로 그대로 넘어간다. 마지막 곡에서는 멈춘다.
 *
 * 오디오 요소는 하나만 둔다. 트랙마다 <audio>를 만들면 브라우저가 여덟 개를
 * 동시에 물고 있게 되고, 한 곡을 누를 때 앞 곡을 멈추는 일을 직접 해야 한다.
 */
export default function TrackBrowser({ isEn }: { isEn: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [current, setCurrent] = useState(1)
  const [playing, setPlaying] = useState(false)

  const track = TRACKS.find(t => t.n === current) ?? TRACKS[0]

  /**
   * 파일을 물리고 재생하는 일은 **클릭 핸들러 안에서 곧바로** 한다.
   *
   * 처음에는 상태를 바꾸고 useEffect에서 play()를 불렀는데, 그러면 재생이
   * 사용자 조작 밖에서 일어난 것이 되어 브라우저가 막는다. 곡은 바뀌고
   * 가사도 따라오는데 소리만 안 나서, 눌러 보기 전에는 멀쩡해 보였다.
   */
  function playTrack(n: number) {
    const el = audioRef.current
    const t = TRACKS.find(x => x.n === n)
    if (!el || !t) return
    setCurrent(n)
    el.src = trackAudioUrl(t.file)
    el.play().catch(() => setPlaying(false))
  }

  // 첫 화면에서는 재생하지 않고 파일만 걸어 둔다(preload="none"이라 받지 않는다).
  useEffect(() => {
    const el = audioRef.current
    if (el && !el.src) el.src = trackAudioUrl(TRACKS[0].file)
  }, [])

  function toggle(n: number) {
    const el = audioRef.current
    if (!el) return
    if (n !== current) {
      playTrack(n)
      return
    }
    if (el.paused) el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  // 곡이 끝나면 다음 곡으로. 이미 재생 중이던 요소라 이어지는 재생은 막히지 않는다.
  function onEnded() {
    const next = TRACKS.find(t => t.n === current + 1)
    if (next) playTrack(next.n)
    else setPlaying(false)
  }

  return (
    <div>
      {/*
        화면에 보이지 않는 재생 엔진이다. 컨트롤은 아래 트랙 목록이 대신하고,
        가사는 옆 칸에 텍스트로 늘 떠 있다 — <track> 자막이 할 일을 그 칸이 한다.
        캡션 파일을 여덟 개 만들 이유가 없다.
      */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        preload="none"
        onEnded={onEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <ol className="overflow-hidden rounded-lg border border-gray-200">
          {TRACKS.map((t, i) => {
            const active = t.n === current
            const isPlaying = active && playing
            return (
              <li
                key={t.n}
                className={active ? 'bg-gray-100' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <button
                  type="button"
                  onClick={() => toggle(t.n)}
                  aria-pressed={isPlaying}
                  aria-label={
                    isEn
                      ? `${isPlaying ? 'Pause' : 'Play'} ${t.title}`
                      : `${t.title} ${isPlaying ? '일시정지' : '재생'}`
                  }
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gray-900"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-400 text-[10px] text-gray-700"
                  >
                    {isPlaying ? '❚❚' : '▶'}
                  </span>
                  <span className="w-5 shrink-0 text-xs tabular-nums text-gray-500">
                    {String(t.n).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-gray-900">{t.title}</span>
                  <span className="shrink-0 text-sm tabular-nums text-gray-500">{t.length}</span>
                </button>
              </li>
            )
          })}
        </ol>

        {/*
          두 칸의 높이를 맞춘다.

          그냥 두면 가사가 긴 곡에서 가사 칸이 목록보다 커지고, 목록은 그
          높이까지 늘어나 아래에 빈 자리가 생긴다. 반대로 각자 제 높이만
          쓰게 하면 두 카드의 아래끝이 어긋난다.

          그래서 바깥 칸은 자리만 잡고(md:relative), 실제 카드를 그 안에
          띄운다(md:absolute inset-0). 카드는 스스로 높이를 갖지 않으므로
          행 높이는 트랙 목록이 정하고, 카드는 딱 그만큼 채운다. 넘치는
          가사는 카드 안에서 스크롤된다. 한 단으로 접히는 모바일에서는
          평범하게 흐르고 가사 칸에만 최대 높이를 준다.
        */}
        <div className="md:relative">
          <div className="flex flex-col rounded-lg border border-gray-200 p-4 md:absolute md:inset-0">
            <p className="shrink-0 text-xs uppercase tracking-widest text-gray-500">
              {String(track.n).padStart(2, '0')} · {track.title}
            </p>
            <pre className="mt-3 max-h-96 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-800 md:max-h-none">
              {LYRICS[track.n]}
            </pre>
          </div>
        </div>
      </div>

      <p className="mt-3 text-sm text-gray-500">
        {isEn
          ? 'Press play and the record runs straight through, one track into the next.'
          : '재생하면 다음 곡으로 이어져 여덟 곡이 그대로 흘러갑니다.'}
      </p>
    </div>
  )
}
