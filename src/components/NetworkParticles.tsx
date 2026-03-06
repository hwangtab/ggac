'use client'

import { useEffect, useRef, useCallback } from 'react'

interface NetworkParticlesProps {
  particleCount: number
  width: number
  height: number
}

const NetworkParticles = ({ particleCount, width, height }: NetworkParticlesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const mousePositionRef = useRef({ x: 0, y: 0 })

  // 기존 WebGLParticles와 동일한 셰이더 (안정성 확보)
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute float a_size;
    attribute float a_alpha;
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    varying float v_alpha;
    
    void main() {
      vec2 parallax = (a_position + u_mouse * 0.1);
      vec2 position = (parallax / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(position * vec2(1, -1), 0, 1);
      gl_PointSize = a_size;
      v_alpha = a_alpha;
    }
  `

  // 협동조합 컬러로 수정된 Fragment 셰이더
  const fragmentShaderSource = `
    precision mediump float;
    varying float v_alpha;
    
    void main() {
      float distance = length(gl_PointCoord - vec2(0.5));
      if (distance > 0.5) discard;
      
      // 협동조합 컬러: 따뜻한 주황-보라 그라데이션
      vec3 coreColor = vec3(1.0, 0.7, 0.3); // 따뜻한 주황
      vec3 edgeColor = vec3(0.8, 0.4, 0.8); // 부드러운 보라
      
      float alpha = v_alpha * (1.0 - distance * 2.0);
      vec3 color = mix(edgeColor, coreColor, 1.0 - distance * 2.0);
      gl_FragColor = vec4(color, alpha * 0.6);
    }
  `

  // 파티클 데이터
  const particleDataRef = useRef<{
    positions: Float32Array
    sizes: Float32Array
    alphas: Float32Array
    velocities: Float32Array
    twinklePhases: Float32Array
    twinkleSpeeds: Float32Array
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
    const sizes = new Float32Array(particleCount)
    const alphas = new Float32Array(particleCount)
    const velocities = new Float32Array(particleCount * 2)
    const twinklePhases = new Float32Array(particleCount)
    const twinkleSpeeds = new Float32Array(particleCount)

    for (let i = 0; i < particleCount; i++) {
      const i2 = i * 2

      // Position
      positions[i2] = Math.random() * width
      positions[i2 + 1] = Math.random() * height

      // Size - 네트워크 노드는 조금 더 큰 사이즈
      sizes[i] = Math.random() * 4 + 2

      // Alpha
      alphas[i] = Math.random() * 0.7 + 0.3

      // Velocity - 느린 움직임으로 안정감 표현
      velocities[i2] = (Math.random() - 0.5) * 0.3
      velocities[i2 + 1] = (Math.random() - 0.5) * 0.3

      // Twinkle
      twinklePhases[i] = Math.random() * Math.PI * 2
      twinkleSpeeds[i] = Math.random() * 0.015 + 0.005
    }

    particleDataRef.current = {
      positions,
      sizes,
      alphas,
      velocities,
      twinklePhases,
      twinkleSpeeds,
    }
  }, [particleCount, width, height])

  // Canvas 2D를 사용한 연결선 렌더링 (WebGL 대신)
  const drawConnections = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')
      const particleData = particleDataRef.current
      if (!ctx || !particleData) return

      const maxConnectDistance = 120
      const mouseInfluenceRadius = 150
      const mouseInfluenceMultiplier = 2.0
      const mouseX = mousePositionRef.current.x
      const mouseY = mousePositionRef.current.y

      ctx.strokeStyle = 'rgba(255, 153, 102, 0.3)' // 협동조합 연결색
      ctx.lineWidth = 1

      for (let i = 0; i < particleCount; i++) {
        for (let j = i + 1; j < particleCount; j++) {
          const i2 = i * 2
          const j2 = j * 2

          const dx = particleData.positions[i2] - particleData.positions[j2]
          const dy = particleData.positions[i2 + 1] - particleData.positions[j2 + 1]
          const distance = Math.sqrt(dx * dx + dy * dy)

          // 마우스 근처 파티클들의 연결 거리 증가
          const midX = (particleData.positions[i2] + particleData.positions[j2]) / 2
          const midY = (particleData.positions[i2 + 1] + particleData.positions[j2 + 1]) / 2
          const mouseDistanceToMid = Math.sqrt((midX - mouseX) ** 2 + (midY - mouseY) ** 2)

          const connectionThreshold =
            mouseDistanceToMid < mouseInfluenceRadius
              ? maxConnectDistance * mouseInfluenceMultiplier
              : maxConnectDistance

          if (distance < connectionThreshold) {
            let alpha = 1.0 - distance / connectionThreshold

            // 마우스 근처에서 연결선 강조
            if (mouseDistanceToMid < mouseInfluenceRadius) {
              alpha *= 1.5
            }

            ctx.globalAlpha = Math.max(0, Math.min(0.3, alpha * 0.3))
            ctx.beginPath()
            ctx.moveTo(particleData.positions[i2], particleData.positions[i2 + 1])
            ctx.lineTo(particleData.positions[j2], particleData.positions[j2 + 1])
            ctx.stroke()
          }
        }
      }

      ctx.globalAlpha = 1 // 원래대로 복원
    },
    [particleCount]
  )

  const render = useCallback(() => {
    const gl = glRef.current
    const program = programRef.current
    const particleData = particleDataRef.current
    const canvas = canvasRef.current

    if (!gl || !program || !particleData || !canvas) return

    // Canvas 전체 클리어
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, width, height)
    }

    // 파티클 위치 및 트윙클 업데이트
    for (let i = 0; i < particleCount; i++) {
      const i2 = i * 2

      // Update positions
      particleData.positions[i2] += particleData.velocities[i2]
      particleData.positions[i2 + 1] += particleData.velocities[i2 + 1]

      // Wrap around screen
      if (particleData.positions[i2] < 0) particleData.positions[i2] = width
      if (particleData.positions[i2] > width) particleData.positions[i2] = 0
      if (particleData.positions[i2 + 1] < 0) particleData.positions[i2 + 1] = height
      if (particleData.positions[i2 + 1] > height) particleData.positions[i2 + 1] = 0

      // Update twinkle
      particleData.twinklePhases[i] += particleData.twinkleSpeeds[i]
      particleData.alphas[i] = Math.abs(Math.sin(particleData.twinklePhases[i])) * 0.6 + 0.4
    }

    // 1. Canvas 2D로 연결선 그리기
    drawConnections(canvas)

    // 2. WebGL로 파티클 그리기
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Set uniforms
    const resolutionUniform = gl.getUniformLocation(program, 'u_resolution')
    const mouseUniform = gl.getUniformLocation(program, 'u_mouse')

    gl.uniform2f(resolutionUniform, width, height)
    gl.uniform2f(mouseUniform, mousePositionRef.current.x, mousePositionRef.current.y)

    // Set attributes
    const positionAttribute = gl.getAttribLocation(program, 'a_position')
    const sizeAttribute = gl.getAttribLocation(program, 'a_size')
    const alphaAttribute = gl.getAttribLocation(program, 'a_alpha')

    // Position buffer
    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.positions, gl.DYNAMIC_DRAW)
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
    gl.bufferData(gl.ARRAY_BUFFER, particleData.alphas, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(alphaAttribute)
    gl.vertexAttribPointer(alphaAttribute, 1, gl.FLOAT, false, 0, 0)

    // Draw particles
    gl.drawArrays(gl.POINTS, 0, particleCount)

    // Cleanup buffers
    gl.deleteBuffer(positionBuffer)
    gl.deleteBuffer(sizeBuffer)
    gl.deleteBuffer(alphaBuffer)
  }, [particleCount, width, height, drawConnections])

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
    console.log('🔗 NetworkParticles (하이브리드) 초기화 시작', { width, height, particleCount })
    if (width < 768) {
      console.log('📱 모바일 화면으로 NetworkParticles 비활성화')
      return
    }

    if (!initWebGL()) {
      console.warn('❌ NetworkParticles WebGL 초기화 실패')
      return
    }

    console.log('✅ NetworkParticles WebGL 초기화 성공')

    initParticles()
    animate()

    window.addEventListener('mousemove', handleMouseMove, { passive: true })

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [
    width,
    height,
    particleCount,
    initWebGL,
    initParticles,
    animate,
    handleMouseMove,
    drawConnections,
    render,
  ])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{
        pointerEvents: 'none',
        zIndex: 30,
        opacity: 0.7,
      }}
    />
  )
}

export default NetworkParticles
