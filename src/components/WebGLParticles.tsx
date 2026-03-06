'use client'

import { useEffect, useRef, useCallback } from 'react'

interface WebGLParticlesProps {
  particleCount: number
  width: number
  height: number
}

// Shader sources hoisted to module level to avoid per-render string recreation
const VERTEX_SHADER_SOURCE = `
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

const FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    varying float v_alpha;

    void main() {
      float distance = length(gl_PointCoord - vec2(0.5));
      if (distance > 0.5) discard;

      float alpha = v_alpha * (1.0 - distance * 2.0);
      gl_FragColor = vec4(1.0, 0.863, 0.706, alpha * 0.6); // 따뜻한 색상
    }
  `

const WebGLParticles = ({ particleCount, width, height }: WebGLParticlesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const mousePositionRef = useRef({ x: 0, y: 0 })

  // WebGL 리소스 참조 - 메모리 최적화
  const buffersRef = useRef<{
    position: WebGLBuffer | null
    size: WebGLBuffer | null
    alpha: WebGLBuffer | null
  }>({ position: null, size: null, alpha: null })

  const locationsRef = useRef<{
    uniforms: {
      resolution: WebGLUniformLocation | null
      mouse: WebGLUniformLocation | null
    }
    attributes: {
      position: number
      size: number
      alpha: number
    }
  } | null>(null)

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
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)

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
    [createShader]
  )

  const initWebGL = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return false

    // WebGL 컨텍스트 최적화 설정
    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      antialias: false, // 성능 향상을 위해 비활성화
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    }

    const gl =
      canvas.getContext('webgl', contextAttributes) ||
      canvas.getContext('experimental-webgl', contextAttributes)
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

    // 위치 및 유니폼 캐싱
    locationsRef.current = {
      uniforms: {
        resolution: webglContext.getUniformLocation(program, 'u_resolution'),
        mouse: webglContext.getUniformLocation(program, 'u_mouse'),
      },
      attributes: {
        position: webglContext.getAttribLocation(program, 'a_position'),
        size: webglContext.getAttribLocation(program, 'a_size'),
        alpha: webglContext.getAttribLocation(program, 'a_alpha'),
      },
    }

    // 재사용 가능한 버퍼 생성
    const buffers = buffersRef.current
    buffers.position = webglContext.createBuffer()
    buffers.size = webglContext.createBuffer()
    buffers.alpha = webglContext.createBuffer()

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

      // Size
      sizes[i] = Math.random() * 3 + 1

      // Alpha
      alphas[i] = Math.random()

      // Velocity
      velocities[i2] = (Math.random() - 0.5) * 0.5
      velocities[i2 + 1] = (Math.random() - 0.5) * 0.5

      // Twinkle
      twinklePhases[i] = Math.random() * Math.PI * 2
      twinkleSpeeds[i] = Math.random() * 0.02 + 0.01
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

  const render = useCallback(() => {
    const gl = glRef.current
    const program = programRef.current
    const particleData = particleDataRef.current
    const locations = locationsRef.current
    const buffers = buffersRef.current

    if (
      !gl ||
      !program ||
      !particleData ||
      !locations ||
      !buffers.position ||
      !buffers.size ||
      !buffers.alpha
    )
      return

    // Clear canvas
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Update particle positions and twinkle (벡터화된 업데이트)
    for (let i = 0; i < particleCount; i++) {
      const i2 = i * 2

      // Update positions
      particleData.positions[i2] += particleData.velocities[i2]
      particleData.positions[i2 + 1] += particleData.velocities[i2 + 1]

      // Wrap around screen
      if (particleData.positions[i2] < 0) particleData.positions[i2] = width
      else if (particleData.positions[i2] > width) particleData.positions[i2] = 0
      if (particleData.positions[i2 + 1] < 0) particleData.positions[i2 + 1] = height
      else if (particleData.positions[i2 + 1] > height) particleData.positions[i2 + 1] = 0

      // Update twinkle (optimized sin calculation)
      particleData.twinklePhases[i] += particleData.twinkleSpeeds[i]
      particleData.alphas[i] = Math.abs(Math.sin(particleData.twinklePhases[i])) * 0.6 + 0.4
    }

    // Set uniforms (cached locations)
    gl.uniform2f(locations.uniforms.resolution, width, height)
    gl.uniform2f(locations.uniforms.mouse, mousePositionRef.current.x, mousePositionRef.current.y)

    // Position buffer (reuse existing buffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.positions, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(locations.attributes.position)
    gl.vertexAttribPointer(locations.attributes.position, 2, gl.FLOAT, false, 0, 0)

    // Size buffer (reuse existing buffer, only update once)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.sizes, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(locations.attributes.size)
    gl.vertexAttribPointer(locations.attributes.size, 1, gl.FLOAT, false, 0, 0)

    // Alpha buffer (reuse existing buffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.alpha)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.alphas, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(locations.attributes.alpha)
    gl.vertexAttribPointer(locations.attributes.alpha, 1, gl.FLOAT, false, 0, 0)

    // Draw particles
    gl.drawArrays(gl.POINTS, 0, particleCount)
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

  // WebGL 리소스 정리
  const cleanup = useCallback(() => {
    const gl = glRef.current
    const program = programRef.current
    const buffers = buffersRef.current

    // 애니메이션 정리
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    // WebGL 리소스 정리
    if (gl && program) {
      // 버퍼 삭제
      if (buffers.position) {
        gl.deleteBuffer(buffers.position)
        buffers.position = null
      }
      if (buffers.size) {
        gl.deleteBuffer(buffers.size)
        buffers.size = null
      }
      if (buffers.alpha) {
        gl.deleteBuffer(buffers.alpha)
        buffers.alpha = null
      }

      // 프로그램 및 셰이더 삭제
      const shaders = gl.getAttachedShaders(program)
      if (shaders) {
        shaders.forEach(shader => {
          gl.detachShader(program, shader)
          gl.deleteShader(shader)
        })
      }
      gl.deleteProgram(program)
      programRef.current = null
    }

    // 참조 정리
    glRef.current = null
    locationsRef.current = null
    particleDataRef.current = null

    // 이벤트 리스너 정리
    window.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  useEffect(() => {
    if (width < 768) return // 모바일에서는 비활성화

    if (!initWebGL()) {
      console.warn('Failed to initialize WebGL')
      return
    }

    initParticles()
    animate()

    window.addEventListener('mousemove', handleMouseMove, { passive: true })

    return cleanup
  }, [initWebGL, initParticles, animate, handleMouseMove, cleanup, width])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{
        pointerEvents: 'none',
        zIndex: 30,
        opacity: 0.6,
      }}
    />
  )
}

export default WebGLParticles
