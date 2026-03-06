'use client'

import { useEffect, useRef, useCallback } from 'react'

interface AudioVisualizationParticlesProps {
  particleCount: number
  width: number
  height: number
}

const AudioVisualizationParticles = ({
  particleCount,
  width,
  height,
}: AudioVisualizationParticlesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const mousePositionRef = useRef({ x: 0, y: 0 })
  const timeRef = useRef(0)

  // 둠메탈 음향 시각화용 Vertex Shader
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute float a_size;
    attribute float a_alpha;
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    uniform float u_time;
    uniform float u_frequency;
    uniform float u_amplitude;
    varying float v_alpha;
    varying float v_waveHeight;
    
    // 간단한 노이즈 함수 (Perlin Noise 대신)
    float noise(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    
    void main() {
      vec2 pos = a_position;
      
      // 둠메탈 저음 웨이브 효과
      float wave = sin(pos.x * u_frequency + u_time) * u_amplitude;
      float noiseOffset = (noise(pos * 0.01 + u_time * 0.1) - 0.5) * 20.0;
      
      // Y축 웨이브 변형 (저음 진동 표현)
      pos.y += wave + noiseOffset;
      
      // 마우스 영향 (주파수 스펙트럼 효과) - 대폭 강화
      vec2 mouseInfluence = u_mouse / u_resolution;
      float distanceToMouse = length((a_position / u_resolution) - mouseInfluence);
      float mouseEffect = exp(-distanceToMouse * 3.0) * 60.0;
      
      // X축 기반 주파수 스펙트럼 (세로 웨이브)
      float spectrumWave = sin(a_position.x * u_frequency * 10.0 + u_time * 3.0) * mouseEffect;
      pos.y += spectrumWave;
      
      // 최종 위치 계산
      vec2 position = (pos / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(position * vec2(1, -1), 0, 1);
      gl_PointSize = a_size + mouseEffect * 0.1;
      
      v_alpha = a_alpha;
      v_waveHeight = (wave + noiseOffset + spectrumWave) / 100.0; // 색상 계산용 (모든 웨이브 포함)
    }
  `

  // 둠메탈 색상 그라디언트 Fragment Shader
  const fragmentShaderSource = `
    precision mediump float;
    varying float v_alpha;
    varying float v_waveHeight;
    
    void main() {
      float distance = length(gl_PointCoord - vec2(0.5));
      if (distance > 0.5) discard;
      
      // 둠메탈 색상 팔레트: 깊은 보라 → 타는 주황
      vec3 deepPurple = vec3(0.2, 0.1, 0.4);   // 저음역 (깊은 보라)
      vec3 burnOrange = vec3(1.0, 0.4, 0.1);   // 고조파 (타는 주황)
      vec3 midTone = vec3(0.6, 0.2, 0.6);      // 중간톤 (자주색)
      
      // 웨이브 높이에 따른 색상 혼합
      float colorMix = clamp(v_waveHeight + 0.5, 0.0, 1.0);
      vec3 color;
      
      if (colorMix < 0.5) {
        // 저음역: 깊은 보라 → 자주색
        color = mix(deepPurple, midTone, colorMix * 2.0);
      } else {
        // 고음역: 자주색 → 타는 주황
        color = mix(midTone, burnOrange, (colorMix - 0.5) * 2.0);
      }
      
      // 중심에서 가장자리로 페이드
      float alpha = v_alpha * (1.0 - distance * 2.0);
      
      // 웨이브 강도에 따른 밝기 조절
      float intensity = 0.7 + abs(v_waveHeight) * 0.5;
      
      gl_FragColor = vec4(color * intensity, alpha * 0.8);
    }
  `

  // 파티클 데이터
  const particleDataRef = useRef<{
    positions: Float32Array
    sizes: Float32Array
    alphas: Float32Array
    basePositions: Float32Array // 원본 위치 저장
  } | null>(null)

  const createShader = useCallback((gl: WebGLRenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null

    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }

    return shader
  }, [])

  const createProgram = useCallback(
    (gl: WebGLRenderingContext) => {
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

      if (!vertexShader || !fragmentShader) return null

      const program = gl.createProgram()
      if (!program) return null

      gl.attachShader(program, vertexShader)
      gl.attachShader(program, fragmentShader)
      gl.linkProgram(program)

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program))
        return null
      }

      return program
    },
    [createShader, vertexShaderSource, fragmentShaderSource]
  )

  const initWebGL = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return false

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl || !('useProgram' in gl)) {
      console.warn('WebGL not supported')
      return false
    }

    const webglContext = gl as WebGLRenderingContext
    glRef.current = webglContext
    const program = createProgram(webglContext)
    if (!program) return false

    programRef.current = program
    webglContext.useProgram(program)

    // 캔버스 크기 설정
    canvas.width = width
    canvas.height = height
    webglContext.viewport(0, 0, width, height)

    // Enable blending for transparency
    webglContext.enable(webglContext.BLEND)
    webglContext.blendFunc(webglContext.SRC_ALPHA, webglContext.ONE_MINUS_SRC_ALPHA)

    return true
  }, [createProgram, width, height])

  const initParticles = useCallback(() => {
    if (!particleCount) return

    const positions = new Float32Array(particleCount * 2)
    const basePositions = new Float32Array(particleCount * 2)
    const sizes = new Float32Array(particleCount)
    const alphas = new Float32Array(particleCount)

    for (let i = 0; i < particleCount; i++) {
      const i2 = i * 2

      // 그리드 형태로 배치 (웨이브 효과를 위해)
      const cols = Math.ceil(Math.sqrt(particleCount))
      const x = ((i % cols) / cols) * width
      const y = (Math.floor(i / cols) / Math.ceil(particleCount / cols)) * height

      positions[i2] = x
      positions[i2 + 1] = y
      basePositions[i2] = x
      basePositions[i2 + 1] = y

      // 둠메탈 특성: 더 큰 파티클, 적당한 투명도
      sizes[i] = Math.random() * 3 + 2
      alphas[i] = Math.random() * 0.4 + 0.6
    }

    particleDataRef.current = {
      positions,
      sizes,
      alphas,
      basePositions,
    }
  }, [particleCount, width, height])

  const render = useCallback(() => {
    const gl = glRef.current
    const program = programRef.current
    const particleData = particleDataRef.current

    if (!gl || !program || !particleData) return

    // 시간 업데이트
    timeRef.current += 0.016 // ~60fps

    // Clear canvas
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // 마우스 위치에 따른 주파수/진폭 계산 (대폭 강화)
    const mouseX = mousePositionRef.current.x / width
    const mouseY = mousePositionRef.current.y / height
    const frequency = 0.005 + mouseX * 0.095 // 0.005~0.1 (20배 증가)
    const amplitude = 30 + mouseY * 120 // 30~150 (3배 증가)

    // 디버깅용 (10초마다 로그)
    if (Math.floor(timeRef.current) % 10 === 0 && Math.floor(timeRef.current * 10) % 10 === 0) {
      console.log('🎵 주파수/진폭:', {
        frequency: frequency.toFixed(3),
        amplitude: amplitude.toFixed(1),
        mouseX: mouseX.toFixed(2),
        mouseY: mouseY.toFixed(2),
      })
    }

    // Set uniforms
    const resolutionUniform = gl.getUniformLocation(program, 'u_resolution')
    const mouseUniform = gl.getUniformLocation(program, 'u_mouse')
    const timeUniform = gl.getUniformLocation(program, 'u_time')
    const frequencyUniform = gl.getUniformLocation(program, 'u_frequency')
    const amplitudeUniform = gl.getUniformLocation(program, 'u_amplitude')

    gl.uniform2f(resolutionUniform, width, height)
    gl.uniform2f(mouseUniform, mousePositionRef.current.x, mousePositionRef.current.y)
    gl.uniform1f(timeUniform, timeRef.current)
    gl.uniform1f(frequencyUniform, frequency)
    gl.uniform1f(amplitudeUniform, amplitude)

    // Set attributes
    const positionAttribute = gl.getAttribLocation(program, 'a_position')
    const sizeAttribute = gl.getAttribLocation(program, 'a_size')
    const alphaAttribute = gl.getAttribLocation(program, 'a_alpha')

    // Position buffer (베이스 위치 사용)
    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.basePositions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(positionAttribute)
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0)

    // Size buffer
    const sizeBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.sizes, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(sizeAttribute)
    gl.vertexAttribPointer(sizeAttribute, 1, gl.FLOAT, false, 0, 0)

    // Alpha buffer
    const alphaBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.alphas, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(alphaAttribute)
    gl.vertexAttribPointer(alphaAttribute, 1, gl.FLOAT, false, 0, 0)

    // Draw particles
    gl.drawArrays(gl.POINTS, 0, particleCount)

    // Cleanup buffers
    gl.deleteBuffer(positionBuffer)
    gl.deleteBuffer(sizeBuffer)
    gl.deleteBuffer(alphaBuffer)
  }, [particleCount, width, height])

  const animate = useCallback(() => {
    render()
    animationFrameRef.current = requestAnimationFrame(animate)
  }, [render])

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    mousePositionRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }, [])

  useEffect(() => {
    console.log('🎵 AudioVisualizationParticles 초기화 시작', { width, height, particleCount })
    if (width < 768) {
      console.log('📱 모바일 화면으로 AudioVisualizationParticles 비활성화')
      return
    }

    if (!initWebGL()) {
      console.warn('❌ AudioVisualizationParticles WebGL 초기화 실패')
      return
    }

    console.log('✅ AudioVisualizationParticles WebGL 초기화 성공')

    initParticles()
    animate()

    window.addEventListener('mousemove', handleMouseMove, { passive: true })

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [initWebGL, initParticles, animate, handleMouseMove, width, height, particleCount])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{
        pointerEvents: 'none',
        zIndex: 30,
        opacity: 0.8,
      }}
    />
  )
}

export default AudioVisualizationParticles
