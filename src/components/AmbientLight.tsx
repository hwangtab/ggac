/**
 * 상시 앰비언트 빛 레이어.
 * 배경 이미지와 글래스 카드 사이(z-index 5~9)에 삽입되어 천천히 드리프트한다.
 * transform/opacity만 사용(GPU compositing). prefers-reduced-motion에서 정지.
 * 모바일에서는 두 번째 레이어를 CSS로 숨겨 GPU 부하를 낮춘다.
 */
const AmbientLight = () => {
  return (
    <div className="absolute inset-0" style={{ zIndex: 5 }} aria-hidden="true">
      {/* 레이어 1 — 따뜻한 빛, 좌상단 */}
      <div
        className="ambient-light ambient-drift"
        style={{
          background:
            'radial-gradient(40% 40% at 35% 30%, rgba(255, 214, 170, 0.28) 0%, rgba(255, 214, 170, 0) 70%)',
          animationDuration: '28s',
        }}
      />
      {/* 레이어 2 — 차가운 빛, 우하단 (모바일에서 숨김: ambient-light-secondary) */}
      <div
        className="ambient-light ambient-drift ambient-light-secondary"
        style={{
          background:
            'radial-gradient(45% 45% at 70% 75%, rgba(150, 190, 255, 0.22) 0%, rgba(150, 190, 255, 0) 70%)',
          animationDuration: '36s',
          animationDirection: 'alternate-reverse',
        }}
      />
    </div>
  )
}

export default AmbientLight
