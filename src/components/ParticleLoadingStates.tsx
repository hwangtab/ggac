'use client'

import { useState, useEffect } from 'react'

/**
 * 고급 파티클 스켈레톤 - 실제 파티클과 유사한 로딩 애니메이션
 */
export const AdvancedParticlesSkeleton = ({ 
  particleCount = 12, 
  width, 
  height 
}: { 
  particleCount?: number
  width: number
  height: number
}) => {
  const [animationPhase, setAnimationPhase] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationPhase(prev => (prev + 1) % 3)
    }, 2000)
    
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div 
        className="relative w-full h-full"
        style={{
          filter: 'blur(0.5px)',
          opacity: 0.4,
        }}
      >
        {Array.from({ length: particleCount }, (_, i) => {
          const x = (Math.sin(i * 0.5) * 0.3 + 0.5) * width
          const y = (Math.cos(i * 0.7) * 0.3 + 0.5) * height
          const size = 2 + (i % 3)
          const delay = (i * 0.1) % 2

          return (
            <div
              key={i}
              className="absolute rounded-full bg-white/20 animate-pulse"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                width: `${size}px`,
                height: `${size}px`,
                animationDelay: `${delay}s`,
                animationDuration: `${1.5 + (i % 2) * 0.5}s`,
                transform: `translate(-50%, -50%) scale(${
                  animationPhase === 0 ? 1 : 
                  animationPhase === 1 ? 1.2 : 0.8
                })`,
                transition: 'transform 2s ease-in-out',
              }}
            />
          )
        })}
      </div>
      
      {/* 로딩 텍스트 (선택적) */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
        <div className="text-white/40 text-sm font-light tracking-wide">
          <span className="animate-pulse">파티클 시스템 로딩 중</span>
          <span className="ml-2">
            {Array.from({ length: 3 }, (_, i) => (
              <span
                key={i}
                className="inline-block w-1 h-1 bg-white/40 rounded-full animate-bounce mx-0.5"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * 미니멀 파티클 스켈레톤 - 단순하고 가벼운 로딩 상태
 */
export const MinimalParticlesSkeleton = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    <div className="animate-pulse duration-2000">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 bg-white/10 rounded-full animate-pulse"
          style={{
            left: `${20 + (i * 9) % 60}%`,
            top: `${30 + (i * 13) % 40}%`,
            animationDelay: `${i * 0.2}s`,
            animationDuration: `${2 + (i % 3) * 0.5}s`,
          }}
        />
      ))}
    </div>
  </div>
)

/**
 * 프로그레시브 로딩 스켈레톤 - 단계별 로딩 시각화
 */
export const ProgressiveParticlesSkeleton = ({ 
  progress = 0 
}: { 
  progress?: number 
}) => {
  const totalDots = 16
  const activeDots = Math.floor((progress / 100) * totalDots)

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* 진행률 표시 */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2">
        <div className="bg-black/20 backdrop-blur-sm rounded-full px-3 py-1">
          <div className="text-white/60 text-xs font-mono">
            {progress.toFixed(0)}%
          </div>
        </div>
      </div>
      
      {/* 진행률에 따른 점진적 파티클 표시 */}
      <div className="grid grid-cols-4 gap-4 w-64 h-32 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        {Array.from({ length: totalDots }, (_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i < activeDots 
                ? 'bg-white/60 scale-100' 
                : 'bg-white/20 scale-75'
            }`}
            style={{
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 웨이브 로딩 애니메이션
 */
export const WaveParticlesSkeleton = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    <div className="absolute inset-0 flex items-center justify-center">
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="w-1 h-8 bg-white/30 rounded-full mx-1 animate-pulse"
          style={{
            animationDelay: `${i * 0.1}s`,
            animationDuration: '1.4s',
            transform: `scaleY(${0.3 + Math.sin(i * 0.5) * 0.4})`,
          }}
        />
      ))}
    </div>
  </div>
)

/**
 * 오류 상태 컴포넌트 - 파티클 로딩 실패 시
 */
export const ParticlesErrorState = ({ 
  onRetry, 
  error 
}: { 
  onRetry?: () => void
  error?: Error | string
}) => {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-black/40 backdrop-blur-sm rounded-lg p-4 max-w-sm mx-4 pointer-events-auto">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 text-red-400/60">
              <svg fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            
            <h3 className="text-white/80 text-sm font-medium mb-2">
              파티클 시스템 로딩 실패
            </h3>
            
            <p className="text-white/60 text-xs mb-3">
              네트워크 상태를 확인하고 다시 시도해주세요
            </p>
            
            {onRetry && (
              <button
                onClick={onRetry}
                className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded transition-colors duration-200 mr-2"
              >
                다시 시도
              </button>
            )}
            
            {error && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-white/40 text-xs underline"
              >
                {showDetails ? '숨기기' : '자세히'}
              </button>
            )}
            
            {showDetails && error && (
              <div className="mt-3 p-2 bg-black/30 rounded text-left">
                <code className="text-red-300/80 text-xs break-all">
                  {typeof error === 'string' ? error : error.message}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 성공 상태 컴포넌트 - 파티클 로딩 완료 시
 */
export const ParticlesSuccessState = ({ 
  onComplete, 
  autoHide = true 
}: { 
  onComplete?: () => void
  autoHide?: boolean
}) => {
  useEffect(() => {
    if (autoHide) {
      const timer = setTimeout(() => {
        onComplete?.()
      }, 1500)
      
      return () => clearTimeout(timer)
    }
  }, [autoHide, onComplete])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-green-500/20 backdrop-blur-sm rounded-full p-3 animate-ping">
          <div className="w-6 h-6 text-green-400">
            <svg fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

// 기본 내보내기
export default AdvancedParticlesSkeleton