/**
 * 지연 로딩 컴포넌트 정의
 * 번들 크기 최적화를 위한 동적 임포트
 */

import React, { lazy } from 'react'
import { ComponentType } from 'react'

// 로딩 컴포넌트
export const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
)

// 관리자 컴포넌트 지연 로딩
export const LazyAdminLayout = lazy(() => import('@/app/admin/components/AdminLayout'))
export const LazyMemberManagement = lazy(() => import('@/app/admin/members/page'))
export const LazyPostManagement = lazy(() => import('@/app/admin/posts/page'))
export const LazyArtistManagement = lazy(() => import('@/app/admin/artists/page'))

// 마이페이지 컴포넌트 지연 로딩
export const LazyMypageLayout = lazy(() => import('@/app/mypage/components/MypageLayout'))
export const LazyArtistProfile = lazy(() => import('@/app/mypage/artist/page'))
export const LazyProfileEdit = lazy(() => import('@/app/mypage/profile/page'))
export const LazyActivityLog = lazy(() => import('@/app/mypage/activity/page'))

// 파티클 시스템 지연 로딩
export const LazyLiquidMetalParticles = lazy(() => import('./LiquidMetalParticles'))
export const LazyOptimizedLiquidMetalParticles = lazy(
  () => import('./OptimizedLiquidMetalParticles')
)
export const LazyWebGLParticles = lazy(() => import('./WebGLParticles'))
export const LazyCSSParticles = lazy(() => import('./CSSParticles'))
export const LazyNetworkParticles = lazy(() => import('./NetworkParticles'))

// 지연 로딩 래퍼 컴포넌트
interface LazyWrapperProps {
  component: ComponentType<any>
  fallback?: React.ReactNode
  [key: string]: any
}

export const LazyWrapper: React.FC<LazyWrapperProps> = ({
  component: Component,
  fallback = <LoadingSpinner />,
  ...props
}) => {
  return (
    <React.Suspense fallback={fallback}>
      <Component {...props} />
    </React.Suspense>
  )
}

const lazyComponents = {
  LazyAdminLayout,
  LazyMemberManagement,
  LazyPostManagement,
  LazyArtistManagement,
  LazyMypageLayout,
  LazyArtistProfile,
  LazyProfileEdit,
  LazyActivityLog,
  LazyLiquidMetalParticles,
  LazyOptimizedLiquidMetalParticles,
  LazyWebGLParticles,
  LazyCSSParticles,
  LazyNetworkParticles,
  LazyWrapper,
  LoadingSpinner,
}

export default lazyComponents
