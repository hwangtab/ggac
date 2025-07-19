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
export const LazyOptimizedLiquidMetalParticles = lazy(() => import('./OptimizedLiquidMetalParticles'))
export const LazyWebGLParticles = lazy(() => import('./WebGLParticles'))
export const LazyCSSParticles = lazy(() => import('./CSSParticles'))
export const LazyNetworkParticles = lazy(() => import('./NetworkParticles'))

// 아이콘 지연 로딩 (중요한 아이콘만 즉시 로드)
export const LazyReactIcons = {
  // 기본 아이콘 (즉시 로드)
  FiMenu: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiMenu }))),
  FiX: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiX }))),
  FiUser: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiUser }))),
  FiHome: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiHome }))),
  
  // 관리자 아이콘 (지연 로드)
  FiUsers: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiUsers }))),
  FiEdit3: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiEdit3 }))),
  FiSettings: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiSettings }))),
  FiBarChart: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiBarChart }))),
  FiActivity: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiActivity }))),
  FiMusic: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiMusic }))),
  
  // 기타 아이콘 (지연 로드)
  FiChevronRight: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiChevronRight }))),
  FiChevronLeft: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiChevronLeft }))),
  FiRefreshCw: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiRefreshCw }))),
  FiDownload: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiDownload }))),
  FiUpload: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiUpload }))),
  FiSearch: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiSearch }))),
  FiFilter: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiFilter }))),
  FiCalendar: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiCalendar }))),
  FiClock: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiClock }))),
  FiMail: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiMail }))),
  FiPhone: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiPhone }))),
  FiMapPin: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiMapPin }))),
  FiGlobe: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiGlobe }))),
  FiInstagram: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiInstagram }))),
  FiYoutube: lazy(() => import('react-icons/fi').then(module => ({ default: module.FiYoutube }))),
}

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

// 페이지별 최적화된 지연 로딩 설정
export const pageOptimizations = {
  admin: {
    preload: ['LazyAdminLayout'],
    defer: ['LazyMemberManagement', 'LazyPostManagement', 'LazyArtistManagement']
  },
  mypage: {
    preload: ['LazyMypageLayout'],
    defer: ['LazyArtistProfile', 'LazyProfileEdit', 'LazyActivityLog']
  },
  particles: {
    preload: [], // 성능 기반 동적 로딩
    defer: ['LazyLiquidMetalParticles', 'LazyOptimizedLiquidMetalParticles', 'LazyWebGLParticles']
  }
}

// 프리로드 유틸리티
export const preloadComponents = async (components: string[]) => {
  const preloadPromises = components.map(async (componentName) => {
    switch (componentName) {
      case 'LazyAdminLayout':
        return import('@/app/admin/components/AdminLayout')
      case 'LazyMypageLayout':
        return import('@/app/mypage/components/MypageLayout')
      case 'LazyLiquidMetalParticles':
        return import('./LiquidMetalParticles')
      // 필요한 경우 더 추가
      default:
        return Promise.resolve()
    }
  })
  
  await Promise.all(preloadPromises)
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
  LazyReactIcons,
  LazyWrapper,
  LoadingSpinner,
  pageOptimizations,
  preloadComponents
}

export default lazyComponents