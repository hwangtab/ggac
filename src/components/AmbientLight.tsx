/**
 * 상시 앰비언트 빛 레이어.
 * 히어로의 어둠 오버레이(다크 오버레이 z10, 중앙 radial z15) "위", 텍스트 카드(z20)
 * "아래"인 z-index 16에 배치한다. 어둠 레이어보다 아래에 두면 mix-blend:screen이
 * 위에 칠해지는 검정을 막지 못해 빛이 묻히므로, 반드시 어둠 위에 올려 화면에 더해지게 한다.
 * transform/opacity만 사용(GPU compositing). prefers-reduced-motion에서 정지.
 * 모바일에서는 두 번째 레이어를 CSS로 숨겨 GPU 부하를 낮춘다.
 * 빛은 화면 가장자리(좌상단·우하단)에 치우쳐 있어 중앙 텍스트 가독성에 영향이 적다.
 */
const AmbientLight = () => {
  return (
    <div className="absolute inset-0" style={{ zIndex: 16 }} aria-hidden="true">
      {/* 레이어 1 — 따뜻한 빛, 좌상단 */}
      <div
        className="ambient-light ambient-drift"
        style={{
          background:
            'radial-gradient(50% 50% at 32% 28%, rgba(255, 200, 150, 0.65) 0%, rgba(255, 200, 150, 0) 72%)',
          animationDuration: '28s',
        }}
      />
      {/* 레이어 2 — 차가운 빛, 우하단 (모바일에서 숨김: ambient-light-secondary) */}
      <div
        className="ambient-light ambient-drift ambient-light-secondary"
        style={{
          background:
            'radial-gradient(55% 55% at 72% 76%, rgba(140, 180, 255, 0.55) 0%, rgba(140, 180, 255, 0) 72%)',
          animationDuration: '36s',
          animationDirection: 'alternate-reverse',
        }}
      />
    </div>
  )
}

export default AmbientLight
