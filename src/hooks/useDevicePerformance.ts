'use client'

import { useEffect, useState, useCallback } from 'react'

export type PerformanceLevel = 'high' | 'medium' | 'low'

interface DevicePerformanceInfo {
  performanceLevel: PerformanceLevel
  hardwareConcurrency: number
  deviceMemory: number | null
  isLowPowerMode: boolean
  gpuTier: 'high' | 'medium' | 'low'
  frameRate: number
  isMobile: boolean
}

/**
 * 디바이스 성능을 감지하고 모니터링하는 훅
 * GPU, CPU, 메모리, 프레임레이트를 종합적으로 분석하여 성능 등급 결정
 */
export function useDevicePerformance(): DevicePerformanceInfo {
  const [performanceInfo, setPerformanceInfo] = useState<DevicePerformanceInfo>({
    performanceLevel: 'medium',
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    deviceMemory: null,
    isLowPowerMode: false,
    gpuTier: 'medium',
    frameRate: 60,
    isMobile: false,
  })

  // GPU 성능 측정
  const measureGPUPerformance = useCallback((): Promise<'high' | 'medium' | 'low'> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      
      if (!gl) {
        resolve('low')
        return
      }

      // GPU 정보 수집
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      let renderer = 'unknown'
      
      if (debugInfo) {
        renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase()
      }

      // GPU 성능 테스트
      const startTime = performance.now()
      const vertices = new Float32Array(10000 * 3) // 10k vertices
      
      for (let i = 0; i < vertices.length; i++) {
        vertices[i] = Math.random() * 2 - 1
      }

      const buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
      
      const endTime = performance.now()
      const processingTime = endTime - startTime

      // GPU 등급 결정
      if (renderer.includes('intel') && renderer.includes('hd')) {
        resolve('low')
      } else if (processingTime < 5) {
        resolve('high')
      } else if (processingTime < 15) {
        resolve('medium')
      } else {
        resolve('low')
      }

      // 정리
      canvas.remove()
    })
  }, [])

  // 프레임레이트 측정
  const measureFrameRate = useCallback((): Promise<number> => {
    return new Promise((resolve) => {
      let frames = 0
      let startTime = performance.now()
      
      const measureFrame = () => {
        frames++
        const currentTime = performance.now()
        
        if (currentTime - startTime >= 1000) {
          resolve(frames)
        } else {
          requestAnimationFrame(measureFrame)
        }
      }
      
      requestAnimationFrame(measureFrame)
    })
  }, [])

  // 모바일 디바이스 감지
  const detectMobile = useCallback((): boolean => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (window.innerWidth <= 768) ||
           ('ontouchstart' in window)
  }, [])

  // 저전력 모드 감지
  const detectLowPowerMode = useCallback(async (): Promise<boolean> => {
    // 배터리 API 지원 확인
    if ('getBattery' in navigator) {
      try {
        const battery = await (navigator as any).getBattery()
        return battery.level < 0.2 || battery.saving
      } catch {
        return false
      }
    }
    return false
  }, [])

  // 종합 성능 등급 결정
  const calculatePerformanceLevel = useCallback((
    gpuTier: 'high' | 'medium' | 'low',
    hardwareConcurrency: number,
    deviceMemory: number | null,
    frameRate: number,
    isMobile: boolean,
    isLowPowerMode: boolean
  ): PerformanceLevel => {
    let score = 0

    // GPU 점수
    if (gpuTier === 'high') score += 3
    else if (gpuTier === 'medium') score += 2
    else score += 1

    // CPU 점수
    if (hardwareConcurrency >= 8) score += 3
    else if (hardwareConcurrency >= 4) score += 2
    else score += 1

    // 메모리 점수
    if (deviceMemory) {
      if (deviceMemory >= 8) score += 3
      else if (deviceMemory >= 4) score += 2
      else score += 1
    } else {
      score += 1 // 기본값
    }

    // 프레임레이트 점수
    if (frameRate >= 55) score += 2
    else if (frameRate >= 30) score += 1

    // 모바일 페널티
    if (isMobile) score -= 2

    // 저전력 모드 페널티
    if (isLowPowerMode) score -= 3

    // 최종 등급 결정
    if (score >= 9) return 'high'
    else if (score >= 6) return 'medium'
    else return 'low'
  }, [])

  useEffect(() => {
    const performanceTest = async () => {
      const isMobile = detectMobile()
      const hardwareConcurrency = navigator.hardwareConcurrency || 4
      const deviceMemory = (navigator as any).deviceMemory || null
      const isLowPowerMode = await detectLowPowerMode()
      
      // 성능 측정 (모바일에서는 간소화)
      const gpuTier = isMobile ? 'low' : await measureGPUPerformance()
      const frameRate = isMobile ? 30 : await measureFrameRate()

      const performanceLevel = calculatePerformanceLevel(
        gpuTier,
        hardwareConcurrency,
        deviceMemory,
        frameRate,
        isMobile,
        isLowPowerMode
      )

      setPerformanceInfo({
        performanceLevel,
        hardwareConcurrency,
        deviceMemory,
        isLowPowerMode,
        gpuTier,
        frameRate,
        isMobile,
      })
    }

    performanceTest()
  }, [detectMobile, detectLowPowerMode, measureGPUPerformance, measureFrameRate, calculatePerformanceLevel])

  return performanceInfo
}