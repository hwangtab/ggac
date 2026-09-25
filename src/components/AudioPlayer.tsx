'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FiPause, FiPlay } from 'react-icons/fi'

interface AudioPlayerProps {
  src: string
  title: React.ReactNode
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 본문 속 음원 한 곡의 플레이어. 브라우저 기본 컨트롤은 사이트 색과 따로 놀아서
 * 재생 버튼·진행 바·시간만 직접 그린다. 진행 바는 투명한 range 입력을 겹쳐
 * 키보드(←→)와 스크린리더 조작을 그대로 쓴다.
 */
export default function AudioPlayer({ src, title }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setCurrent(audio.currentTime)
    const onMeta = () => setDuration(audio.duration)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    if (audio.readyState >= 1) onMeta()
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
    }
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => setPlaying(false))
    else audio.pause()
  }, [])

  const seek = useCallback((value: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value
    setCurrent(value)
  }, [])

  const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  return (
    <span className="not-prose my-6 flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- 음악 음원이라 옮길 말소리가 없다 */}
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? '일시정지' : '재생'}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        {playing ? (
          <FiPause className="h-5 w-5" aria-hidden />
        ) : (
          <FiPlay className="ml-0.5 h-5 w-5" aria-hidden />
        )}
      </button>
      <span className="block min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-gray-900">{title}</span>
        <span className="relative mt-3 block h-1 w-full text-gray-900">
          <span className="absolute inset-0 rounded-full bg-current opacity-20" />
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-current"
            style={{ width: `${percent}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={e => seek(Number(e.target.value))}
            aria-label="재생 위치"
            aria-valuetext={`${formatTime(current)} / ${formatTime(duration)}`}
            className="absolute -inset-y-2 left-0 w-full cursor-pointer opacity-0"
          />
        </span>
        <span className="mt-2 flex justify-between text-xs tabular-nums text-gray-500">
          <span>{formatTime(current)}</span>
          <span>{formatTime(duration)}</span>
        </span>
      </span>
    </span>
  )
}
