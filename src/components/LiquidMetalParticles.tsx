'use client'

import { useEffect, useRef, useCallback } from 'react'

interface LiquidMetalParticlesProps {
  particleCount: number
  width: number
  height: number
}

const LiquidMetalParticles = ({ particleCount, width, height }: LiquidMetalParticlesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const mousePositionRef = useRef({ x: width / 2, y: height / 2 })
  const timeRef = useRef(0)

  // Stage 2: 고도화된 액체 금속 물리 시뮬레이션 Vertex Shader
  const vertexShaderSource = `
    precision mediump float;
    attribute vec2 a_position;
    attribute vec2 a_velocity;
    attribute float a_mass;
    attribute float a_metallic;
    attribute float a_density;      // Stage 3: 밀도
    attribute float a_temperature;  // Stage 3: 온도
    uniform mediump vec2 u_resolution;
    uniform mediump vec2 u_mouse;
    uniform mediump float u_time;
    uniform mediump float u_gravity;
    uniform mediump float u_magneticForce;
    varying float v_metallic;
    varying vec2 v_velocity;
    varying float v_distanceToMouse;
    varying float v_density;        // Stage 3: 밀도 전달
    varying float v_temperature;    // Stage 3: 온도 전달
    
    // 고급 노이즈 함수 (자연스러운 액체 흐름용)
    float noise(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    
    float smoothNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      
      float a = noise(i);
      float b = noise(i + vec2(1.0, 0.0));
      float c = noise(i + vec2(0.0, 1.0));
      float d = noise(i + vec2(1.0, 1.0));
      
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    void main() {
      vec2 pos = a_position;
      vec2 vel = a_velocity;
      
      // 마우스와의 거리 계산
      vec2 mousePos = u_mouse;
      vec2 toMouse = mousePos - pos;
      float distToMouse = length(toMouse);
      v_distanceToMouse = distToMouse;
      
      // Stage 2: 향상된 자력 시스템 (다중 범위) - 조건문 제거
      float nearFieldRange = 80.0;   // 근거리 강력한 자력
      float farFieldRange = 250.0;   // 원거리 약한 자력
      
      vec2 magneticDir = normalize(toMouse + vec2(0.001)); // 0으로 나누기 방지
      float farMask = 1.0 - step(farFieldRange, distToMouse); // farFieldRange 내부면 1.0
      
      // 근거리와 원거리 강도 계산
      float nearFactor = 1.0 - (distToMouse / nearFieldRange);
      float nearStrength = pow(max(nearFactor, 0.0), 2.0) * u_magneticForce * 1.5;
      
      float farFactor = 1.0 - ((distToMouse - nearFieldRange) / (farFieldRange - nearFieldRange));
      float farStrength = max(farFactor, 0.0) * u_magneticForce * 0.3;
      
      // 근거리/원거리 마스크
      float nearMask = 1.0 - step(nearFieldRange, distToMouse);
      float magneticStrength = nearMask * nearStrength + (1.0 - nearMask) * farStrength;
      
      // 질량에 따른 자력 반응 (가벼운 파티클이 더 민감)
      float massEffect = 2.0 - a_mass; // 질량이 작을수록 큰 값
      pos += magneticDir * magneticStrength * massEffect * farMask;
      
      // Stage 2: 향상된 중력 시스템 (터미널 속도 고려)
      float terminalVelocity = 15.0;
      float gravityEffect = u_gravity * a_mass;
      
      // 현재 속도에 따른 공기 저항 시뮬레이션
      float currentSpeed = length(vel);
      float airResistance = min(currentSpeed / terminalVelocity, 1.0);
      gravityEffect *= (1.0 - airResistance * 0.3);
      
      pos.y += gravityEffect;
      
      // Stage 2: 향상된 액체 점성 및 흐름 시스템
      float timeFlow = u_time * 0.3;
      float viscosityNoise = smoothNoise(pos * 0.008 + vec2(timeFlow, 0.0));
      float viscosityStrength = viscosityNoise * 8.0 + 2.0;
      
      // 수평 흐름 (점성에 의한 자연스러운 움직임)
      float horizontalFlow = sin(timeFlow + pos.y * 0.008) * viscosityStrength;
      pos.x += horizontalFlow;
      
      // 수직 흐름 (복잡한 액체 패턴)
      float verticalTurbulence = smoothNoise(vec2(pos.x * 0.01, u_time * 0.2)) * 3.0;
      pos.y += verticalTurbulence;
      
      // Stage 2: 향상된 경계 처리 (부드러운 액체 풀링) - 조건문 제거
      float poolDepth = 60.0;
      float poolSurface = u_resolution.y - poolDepth;
      
      // 풀 내부 마스크
      float poolMask = step(poolSurface, pos.y);
      
      // 액체 풀 내부에서의 움직임
      float submersionDepth = clamp((pos.y - poolSurface) / poolDepth, 0.0, 1.0);
      
      // 풀 바닥에 가까워질수록 수평 이동 증가
      float poolFlow = sin(u_time * 1.5 + pos.x * 0.05) * (5.0 + submersionDepth * 10.0);
      pos.x += poolFlow * poolMask;
      
      // 풀 표면에서 약간의 반발 효과
      float surfaceMask = 1.0 - step(0.2, submersionDepth); // submersionDepth < 0.2면 1.0
      float surfaceTension = sin(u_time * 4.0 + pos.x * 0.1) * 2.0;
      pos.y += surfaceTension * (1.0 - submersionDepth * 5.0) * surfaceMask * poolMask;
      
      // 풀 내부 제한
      pos.y = mix(pos.y, min(pos.y, u_resolution.y - 10.0), poolMask);
      
      // 수평 경계 처리 (부드러운 래핑) - 조건문 제거
      float edgeBuffer = 30.0;
      float leftMask = step(pos.x, -edgeBuffer);
      float rightMask = step(u_resolution.x + edgeBuffer, pos.x);
      
      pos.x = mix(pos.x, u_resolution.x + edgeBuffer, leftMask);
      pos.x = mix(pos.x, -edgeBuffer, rightMask);
      
      // 상단 경계 처리
      pos.y = max(pos.y, 0.0);
      
      // 최종 위치 계산
      vec2 position = (pos / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(position * vec2(1, -1), 0, 1);
      
      // Stage 4: 고급 동적 크기 계산 (예술적 효과 포함)
      float baseSizeMultiplier = a_metallic * 0.8 + 0.4;
      
      // 마우스 거리에 따른 크기 변화 (비선형)
      float mouseEffect = 1.0 - min(distToMouse / 120.0, 1.0);
      mouseEffect = pow(mouseEffect, 1.5) * 2.5;
      
      // Stage 4: 속도 기반 모션 블러 크기 (빠를수록 길어짐)
      float velocityMagnitude = length(vel);
      float motionStretch = 1.0 + min(velocityMagnitude / 8.0, 0.8);
      
      // Stage 4: 밀도 기반 크기 변화 (압축/팽창 효과)
      float densityEffect = 0.8 + (a_density - 1.0) * 0.4;
      
      // Stage 4: 온도 기반 에너지 팽창
      float thermalExpansion = 1.0 + (a_temperature - 0.5) * 0.3;
      
      // Stage 4: 파편화 효과 (높은 밀도에서 불규칙한 크기) - 조건문 제거
      float fragmentNoise = noise(pos * 0.1 + u_time * 0.5);
      float densityFragmentMask = step(1.5, a_density);
      float fragmentationScale = mix(1.0, 0.7 + fragmentNoise * 0.6, densityFragmentMask);
      
      // 시간에 따른 미묘한 크기 변화 (생동감)
      float timeVariation = sin(u_time * 2.0 + distToMouse * 0.1) * 0.1 + 1.0;
      
      // Stage 4: 홀로그래픽 효과 크기 변화 (메탈릭 강도에 따라)
      float holographicPulse = 1.0 + sin(u_time * 3.0 + a_metallic * 10.0) * a_metallic * 0.15;
      
      // 최종 크기 계산 (Stage 4: 모든 효과 통합)
      float finalSize = (6.0 + baseSizeMultiplier * 4.0 + mouseEffect) * 
                        motionStretch * densityEffect * thermalExpansion * 
                        fragmentationScale * timeVariation * holographicPulse;
      
      gl_PointSize = clamp(finalSize, 3.0, 40.0); // Phase 1: 크기 확대 (2-25 → 3-40)
      
      v_metallic = a_metallic;
      v_velocity = vel;
      v_density = a_density;
      v_temperature = a_temperature;
    }
  `

  // Stage 2: 고도화된 메탈릭 액체 Fragment Shader
  const fragmentShaderSource = `
    precision mediump float;
    varying float v_metallic;
    varying vec2 v_velocity;
    varying float v_distanceToMouse;
    varying float v_density;        // Stage 3: 밀도
    varying float v_temperature;    // Stage 3: 온도
    uniform mediump float u_time;
    
    // 고급 노이즈 함수 (Simplex Noise 근사)
    float noise(vec2 p) {
      return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }
    
    float smoothNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      
      float a = noise(i);
      float b = noise(i + vec2(1.0, 0.0));
      float c = noise(i + vec2(0.0, 1.0));
      float d = noise(i + vec2(1.0, 1.0));
      
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      float distance = length(coord);
      
      // 원형 파티클 (액체 방울) - 부드러운 경계 (discard 제거)
      float circleMask = 1.0 - step(0.5, distance); // distance <= 0.5면 1.0, 아니면 0.0
      
      // Stage 2: 다층 메탈릭 색상 시스템
      vec3 chromiumBase = vec3(0.55, 0.56, 0.67);     // 크롬 베이스
      vec3 chromiumHighlight = vec3(0.95, 0.95, 1.0); // 크롬 하이라이트
      vec3 chromiumDark = vec3(0.1, 0.12, 0.15);      // 크롬 암부
      
      vec3 aluminumBase = vec3(0.91, 0.92, 0.92);     // 알루미늄 베이스
      vec3 aluminumHighlight = vec3(1.0, 1.0, 1.0);   // 알루미늄 하이라이트
      vec3 aluminumDark = vec3(0.4, 0.42, 0.44);      // 알루미늄 암부
      
      // 거리 기반 색상 혼합
      float edgeFactor = 1.0 - distance * 2.0;
      
      // 고급 Fresnel 반사 계산
      float fresnel = pow(1.0 - edgeFactor, 1.8);
      float fresnelInverse = 1.0 - fresnel;
      
      // Stage 3: 밀도와 온도에 따른 재질 변화
      float densityFactor = clamp(v_density - 0.8, 0.0, 1.0); // 밀도가 높을수록 더 어두워짐
      float temperatureFactor = v_temperature; // 온도가 높을수록 더 밝아짐
      
      // 메탈릭 강도에 따른 재질 선택 (밀도/온도 영향 추가)
      vec3 baseColor = mix(chromiumBase, aluminumBase, v_metallic);
      vec3 highlightColor = mix(chromiumHighlight, aluminumHighlight, v_metallic);
      vec3 darkColor = mix(chromiumDark, aluminumDark, v_metallic);
      
      // 밀도 효과: 높은 밀도에서 더 어두워짐
      baseColor = mix(baseColor, darkColor, densityFactor * 0.4);
      
      // 온도 효과: 높은 온도에서 약간의 적색 틴트
      vec3 heatTint = vec3(1.0, 0.6, 0.3) * temperatureFactor * 0.2;
      baseColor += heatTint;
      
      // 노이즈 기반 표면 거칠기 시뮬레이션
      float surfaceNoise = smoothNoise(coord * 15.0 + u_time * 0.5);
      float roughness = 0.1 + surfaceNoise * 0.3;
      
      // 환경 반사 효과 (시간 기반 환경광 변화)
      float envRotation = u_time * 0.2;
      vec2 envCoord = coord;
      envCoord = vec2(
        envCoord.x * cos(envRotation) - envCoord.y * sin(envRotation),
        envCoord.x * sin(envRotation) + envCoord.y * cos(envRotation)
      );
      float envReflection = smoothNoise(envCoord * 8.0 + vec2(u_time * 0.3, 0.0));
      
      // 다층 반사 색상 계산
      vec3 primaryReflection = mix(darkColor, baseColor, edgeFactor);
      vec3 secondaryReflection = mix(baseColor, highlightColor, fresnel);
      vec3 environmentReflection = mix(primaryReflection, secondaryReflection, envReflection * 0.7);
      
      // 마우스 근처에서 강화된 에너지 글로우 (다층 시스템)
      float mouseInfluence = 1.0 - min(v_distanceToMouse / 120.0, 1.0);
      vec3 coreGlow = vec3(0.2, 0.4, 0.9) * mouseInfluence * 0.6;        // 코어 블루 글로우
      vec3 rimGlow = vec3(0.9, 0.7, 0.3) * mouseInfluence * 0.3;         // 림 골드 글로우
      vec3 energyGlow = coreGlow + rimGlow * fresnel;
      
      // 액체 흐름 표현 (속도 기반 스트림 라인)
      float velocityMagnitude = length(v_velocity);
      float flowEffect = sin(coord.x * 20.0 + u_time * velocityMagnitude * 2.0) * 0.05;
      
      // 시간에 따른 메탈릭 시머 효과
      float timeShimmer = sin(u_time * 4.0 + v_distanceToMouse * 0.08 + surfaceNoise * 3.14) * 0.15 + 0.85;
      float metallicShimmer = sin(u_time * 2.5 + distance * 10.0) * v_metallic * 0.1 + 0.9;
      
      // Phase 2: 복잡한 아트 효과 간소화 (가시성 우선)
      // 모션 블러와 파편화 효과 제거하여 성능 향상 및 단순화
      
      // Stage 4: 에너지 글로우 확장 (온도 기반)
      float energyIntensity = v_temperature * (1.0 + v_density * 0.5);
      vec3 coreEnergyGlow = vec3(0.2, 0.4, 0.9) * mouseInfluence * 0.6 * energyIntensity;
      vec3 thermalGlow = vec3(1.0, 0.5, 0.2) * v_temperature * 0.3; // 열 복사 글로우
      vec3 expandedEnergyGlow = coreEnergyGlow + rimGlow * fresnel + thermalGlow;
      
      // Stage 4: 홀로그래픽 효과 (각도에 따른 색상 변화)
      float holographicShift = sin(atan(coord.y, coord.x) * 3.0 + u_time * 1.5) * 0.1;
      vec3 holographicTint = vec3(
        0.5 + sin(u_time * 0.7 + distance * 5.0) * 0.2,
        0.5 + sin(u_time * 0.9 + distance * 7.0) * 0.2,
        0.5 + sin(u_time * 1.1 + distance * 6.0) * 0.2
      ) * v_metallic * holographicShift;
      
      // Phase 2: 단순화된 최종 색상 조합 (파편화 효과 제거)
      vec3 metallicSurface = (environmentReflection + holographicTint) * timeShimmer * metallicShimmer;
      vec3 finalColor = metallicSurface + expandedEnergyGlow + vec3(flowEffect);
      
      // Stage 4: 고급 색상 보정
      // HDR 톤 매핑 (ACES-like)
      finalColor = finalColor * (finalColor * 2.51 + 0.03) / (finalColor * (finalColor * 2.43 + 0.59) + 0.14);
      finalColor = pow(finalColor, vec3(0.85)); // 감마 보정
      
      // 색 온도 효과 (온도에 따른 색조 변화) - 조건문 제거
      float tempEffect = clamp((v_temperature - 0.8) * 2.0, 0.0, 1.0);
      finalColor = mix(finalColor, finalColor * vec3(1.2, 0.9, 0.7), tempEffect);
      
      // Phase 1: 단순화된 투명도 시스템 (가시성 최우선)
      float baseAlpha = edgeFactor * (0.9 + v_metallic * 0.1); // 0.75 → 0.9로 증가
      
      // 에너지 글로우 투명도 (마우스 근처에서 더 밝게)
      float energyAlpha = 1.0 + mouseInfluence * 0.4; // 0.3 → 0.4로 증가
      
      // 단순화된 최종 투명도 (복잡한 다층 시스템 제거)
      float alpha = baseAlpha * energyAlpha;
      alpha = clamp(alpha * 0.95, 0.0, 1.0); // 0.85 → 0.95로 증가
      
      // Stage 4: 고급 블룸 효과 (밝은 영역에서 글로우 확산) - 조건문 제거
      float bloomThreshold = 0.7;
      float luminance = dot(finalColor, vec3(0.299, 0.587, 0.114));
      float bloomMask = step(bloomThreshold, luminance);
      float bloomIntensity = (luminance - bloomThreshold) / (1.0 - bloomThreshold);
      alpha += bloomMask * bloomIntensity * 0.4 * (1.0 - distance * 2.0);
      
      gl_FragColor = vec4(finalColor, alpha * circleMask);
    }
  `

  // Stage 3: 유체 역학용 확장된 파티클 데이터
  const particleDataRef = useRef<{
    positions: Float32Array
    velocities: Float32Array
    masses: Float32Array
    metallics: Float32Array
    forces: Float32Array
    // Stage 3: 새로운 유체 속성들
    densities: Float32Array      // 밀도 (주변 파티클 영향)
    pressures: Float32Array      // 압력 (SPH 유체 시뮬레이션)
    temperatures: Float32Array   // 온도 (색상 및 반응성 영향)
    cohesion: Float32Array      // 응집력 (파티클 간 끌어당김)
    surfaceTension: Float32Array // 표면 장력
  } | null>(null)

  const createShader = useCallback((gl: WebGLRenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) {
      console.error('🔴 Failed to create shader')
      return null
    }
    
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader)
      console.error('🔴 Liquid Metal Shader Compile Error:', error)
      console.error('🔴 Shader Type:', type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT')
      console.error('🔴 Shader Source:', source)
      gl.deleteShader(shader)
      return null
    }
    
    return shader
  }, [])

  const createProgram = useCallback((gl: WebGLRenderingContext) => {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
    
    if (!vertexShader || !fragmentShader) return null
    
    const program = gl.createProgram()
    if (!program) return null
    
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('🔴 Liquid Metal Program Error:', gl.getProgramInfoLog(program))
      return null
    }
    
    return program
  }, [createShader, vertexShaderSource, fragmentShaderSource])

  const initWebGL = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      console.error('🔴 Canvas element not found')
      return false
    }

    console.log('🔄 Attempting WebGL initialization...')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl || !('useProgram' in gl)) {
      console.error('❌ WebGL not supported or not available')
      console.log('Browser WebGL info:', {
        webgl: !!canvas.getContext('webgl'),
        experimental: !!canvas.getContext('experimental-webgl'),
        userAgent: navigator.userAgent
      })
      return false
    }

    console.log('✅ WebGL context created successfully')
    const webglContext = gl as WebGLRenderingContext
    glRef.current = webglContext
    
    console.log('🔄 Creating shader program...')
    const program = createProgram(webglContext)
    if (!program) {
      console.error('❌ Failed to create shader program')
      return false
    }

    console.log('✅ Shader program created successfully')
    programRef.current = program
    webglContext.useProgram(program)

    canvas.width = width
    canvas.height = height
    webglContext.viewport(0, 0, width, height)

    // Stage 4: 고급 블렌딩 설정 (아트 효과용)
    webglContext.enable(webglContext.BLEND)
    // 가산 블렌딩으로 글로우 효과 강화
    webglContext.blendFunc(webglContext.SRC_ALPHA, webglContext.ONE_MINUS_SRC_ALPHA)
    webglContext.blendEquation(webglContext.FUNC_ADD)

    console.log('✅ WebGL initialization completed successfully')
    return true
  }, [createProgram, width, height])

  const initParticles = useCallback(() => {
    if (!particleCount) return

    const positions = new Float32Array(particleCount * 2)
    const velocities = new Float32Array(particleCount * 2)
    const masses = new Float32Array(particleCount)
    const metallics = new Float32Array(particleCount)
    const forces = new Float32Array(particleCount * 2)
    
    // Stage 3: 새로운 유체 속성 배열들
    const densities = new Float32Array(particleCount)
    const pressures = new Float32Array(particleCount)
    const temperatures = new Float32Array(particleCount)
    const cohesion = new Float32Array(particleCount)
    const surfaceTension = new Float32Array(particleCount)

    for (let i = 0; i < particleCount; i++) {
      const i2 = i * 2
      const angle = (i / particleCount) * Math.PI * 2
      
      // 다이내믹 개선: 전체 화면에 광범위하게 분산 (바닥에서 시작하여 폭발적 확산)
      const spawnPattern = Math.random()
      
      if (spawnPattern < 0.6) {
        // 60%: 화면 중앙에서 대형 폭발 (더 넓고 높게)
        positions[i2] = width * (0.35 + Math.random() * 0.3) // 중앙 좁은 범위에서 시작
        positions[i2 + 1] = height * (0.4 + Math.random() * 0.2) // 중앙 높이에서 시작
        
        // 전방향 대폭발 초기 속도 (360도 모든 방향으로)
        const explosionAngle = Math.random() * Math.PI * 2 // 0-360도 완전 방사형
        const explosionForce = 20 + Math.random() * 35 // 20-55 더욱 강력한 힘
        velocities[i2] = Math.cos(explosionAngle) * explosionForce
        velocities[i2 + 1] = Math.sin(explosionAngle) * explosionForce
      } else if (spawnPattern < 0.8) {
        // 20%: 화면 가장자리에서 중앙으로 
        const edge = Math.floor(Math.random() * 4)
        if (edge === 0) { // 좌측
          positions[i2] = Math.random() * width * 0.1
          positions[i2 + 1] = Math.random() * height
          // 중앙으로 향하는 초기 속도
          velocities[i2] = 8 + Math.random() * 12 // 우향
          velocities[i2 + 1] = (Math.random() - 0.5) * 8
        } else if (edge === 1) { // 우측
          positions[i2] = width * (0.9 + Math.random() * 0.1)
          positions[i2 + 1] = Math.random() * height
          // 중앙으로 향하는 초기 속도
          velocities[i2] = -(8 + Math.random() * 12) // 좌향
          velocities[i2 + 1] = (Math.random() - 0.5) * 8
        } else if (edge === 2) { // 상단
          positions[i2] = Math.random() * width
          positions[i2 + 1] = Math.random() * height * 0.1
          // 하향 + 중앙으로
          velocities[i2] = (Math.random() - 0.5) * 10
          velocities[i2 + 1] = 5 + Math.random() * 10 // 하향
        } else { // 하단
          positions[i2] = Math.random() * width
          positions[i2 + 1] = height * (0.9 + Math.random() * 0.1)
          // 상향 + 중앙으로
          velocities[i2] = (Math.random() - 0.5) * 10
          velocities[i2 + 1] = -(3 + Math.random() * 8) // 상향
        }
      } else {
        // 20%: 전체 화면 랜덤 분산
        positions[i2] = Math.random() * width
        positions[i2 + 1] = Math.random() * height
        // 랜덤 방향 초기 속도
        const randomAngle = Math.random() * Math.PI * 2
        const randomForce = 3 + Math.random() * 8
        velocities[i2] = Math.cos(randomAngle) * randomForce
        velocities[i2 + 1] = Math.sin(randomAngle) * randomForce
      }
      
      // 질량 분포 (일부는 가볍고 일부는 무거움)
      const massVariation = Math.random()
      if (massVariation < 0.3) {
        masses[i] = 0.4 + Math.random() * 0.3 // 가벼운 파티클
      } else if (massVariation < 0.7) {
        masses[i] = 0.8 + Math.random() * 0.4 // 중간 파티클
      } else {
        masses[i] = 1.2 + Math.random() * 0.6 // 무거운 파티클
      }
      
      // 메탈릭 강도 (일부는 매우 반짝이고 일부는 무딤)
      const metallicVariation = Math.random()
      if (metallicVariation < 0.2) {
        metallics[i] = 0.9 + Math.random() * 0.1 // 매우 반짝임
      } else if (metallicVariation < 0.8) {
        metallics[i] = 0.5 + Math.random() * 0.4 // 보통 반짝임
      } else {
        metallics[i] = 0.2 + Math.random() * 0.3 // 무딤
      }
      
      // 힘 초기화
      forces[i2] = 0
      forces[i2 + 1] = 0
      
      // Stage 3: 유체 속성 초기화
      densities[i] = 1.0 + Math.random() * 0.2        // 기본 밀도
      pressures[i] = 0.0                              // 초기 압력
      temperatures[i] = 0.7 + Math.random() * 0.3     // 초기 온도
      cohesion[i] = 0.5 + Math.random() * 0.5         // 응집력
      surfaceTension[i] = 0.8 + Math.random() * 0.4   // 표면 장력
    }

    particleDataRef.current = {
      positions,
      velocities,
      masses,
      metallics,
      forces,
      // Stage 3: 새로운 유체 속성들
      densities,
      pressures,
      temperatures,
      cohesion,
      surfaceTension
    }
  }, [particleCount, width, height])

  // Stage 3: 유체 역학 시뮬레이션 함수 (SPH - Smoothed Particle Hydrodynamics)
  const updateFluidDynamics = useCallback((particleData: NonNullable<typeof particleDataRef.current>) => {
    const interactionRadius = 25.0  // 파티클 간 영향 반경
    const dampingFactor = 0.98      // 속도 감쇠
    const cohesionStrength = 0.02   // 응집력 강도
    const separationStrength = 0.8  // 분리력 강도
    const alignmentStrength = 0.05  // 정렬력 강도

    // 1단계: 밀도 및 압력 계산
    for (let i = 0; i < particleCount; i++) {
      const i2 = i * 2
      let density = 0.0
      let neighborCount = 0

      // 주변 파티클 탐색
      for (let j = 0; j < particleCount; j++) {
        if (i === j) continue
        
        const j2 = j * 2
        const dx = particleData.positions[i2] - particleData.positions[j2]
        const dy = particleData.positions[i2 + 1] - particleData.positions[j2 + 1]
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance < interactionRadius) {
          // SPH kernel function (simplified)
          const influence = 1.0 - (distance / interactionRadius)
          density += particleData.masses[j] * influence * influence
          neighborCount++
        }
      }

      // 밀도 업데이트
      particleData.densities[i] = Math.max(density, 0.1)
      
      // 압력 계산 (상태 방정식)
      const restDensity = 1.0
      particleData.pressures[i] = Math.max(0.0, (particleData.densities[i] - restDensity) * 0.5)
      
      // 온도 업데이트 (주변 파티클 수에 따라 변화)
      const targetTemperature = 0.5 + (neighborCount / 10.0) * 0.5
      particleData.temperatures[i] = particleData.temperatures[i] * 0.95 + targetTemperature * 0.05
    }

    // 2단계: 힘 계산 및 적용
    for (let i = 0; i < particleCount; i++) {
      const i2 = i * 2
      let forceX = 0.0
      let forceY = 0.0
      let avgVelX = 0.0
      let avgVelY = 0.0
      let neighborCount = 0

      for (let j = 0; j < particleCount; j++) {
        if (i === j) continue
        
        const j2 = j * 2
        const dx = particleData.positions[i2] - particleData.positions[j2]
        const dy = particleData.positions[i2 + 1] - particleData.positions[j2 + 1]
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance < interactionRadius && distance > 0.01) {
          const normalizedDx = dx / distance
          const normalizedDy = dy / distance
          const influence = 1.0 - (distance / interactionRadius)

          // 압력 기반 분리력 (파티클이 너무 가까워지지 않도록)
          const pressureForce = (particleData.pressures[i] + particleData.pressures[j]) * influence
          forceX += normalizedDx * pressureForce * separationStrength
          forceY += normalizedDy * pressureForce * separationStrength

          // 응집력 (파티클들이 서로 끌어당김)
          const cohesionForce = particleData.cohesion[i] * particleData.cohesion[j] * influence * influence
          forceX -= normalizedDx * cohesionForce * cohesionStrength
          forceY -= normalizedDy * cohesionForce * cohesionStrength

          // 점성력 (속도 평균화)
          avgVelX += particleData.velocities[j2]
          avgVelY += particleData.velocities[j2 + 1]
          neighborCount++

          // 표면 장력 효과 (경계 근처에서)
          if (distance < interactionRadius * 0.5) {
            const surfaceTensionForce = particleData.surfaceTension[i] * influence
            forceX -= normalizedDx * surfaceTensionForce * 0.01
            forceY -= normalizedDy * surfaceTensionForce * 0.01
          }
        }
      }

      // 속도 업데이트 (힘 적용)
      particleData.velocities[i2] += forceX * 0.1
      particleData.velocities[i2 + 1] += forceY * 0.1

      // 점성 효과 (이웃 파티클과 속도 평균화)
      if (neighborCount > 0) {
        avgVelX /= neighborCount
        avgVelY /= neighborCount
        
        const viscosity = 0.02
        particleData.velocities[i2] += (avgVelX - particleData.velocities[i2]) * viscosity
        particleData.velocities[i2 + 1] += (avgVelY - particleData.velocities[i2 + 1]) * viscosity
      }

      // 속도 제한 (폭발 방지)
      const maxVelocity = 8.0
      const currentSpeed = Math.sqrt(
        particleData.velocities[i2] * particleData.velocities[i2] + 
        particleData.velocities[i2 + 1] * particleData.velocities[i2 + 1]
      )
      
      if (currentSpeed > maxVelocity) {
        const scale = maxVelocity / currentSpeed
        particleData.velocities[i2] *= scale
        particleData.velocities[i2 + 1] *= scale
      }

      // 속도 감쇠
      particleData.velocities[i2] *= dampingFactor
      particleData.velocities[i2 + 1] *= dampingFactor

      // 위치 업데이트 (Verlet integration)
      particleData.positions[i2] += particleData.velocities[i2]
      particleData.positions[i2 + 1] += particleData.velocities[i2 + 1]
    }
  }, [particleCount])

  const render = useCallback(() => {
    const gl = glRef.current
    const program = programRef.current
    const particleData = particleDataRef.current
    
    if (!gl || !program || !particleData) return

    timeRef.current += 0.016

    // Stage 3: 유체 역학 시뮬레이션 (파티클 간 상호작용)
    updateFluidDynamics(particleData)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Stage 2: 향상된 물리 파라미터 계산
    const gravity = 1.2 // 약간 감소된 중력 (더 부드러운 흐름)
    const magneticBaseForce = 4.0
    const magneticPulse = Math.sin(timeRef.current * 0.3) * 1.5 + Math.cos(timeRef.current * 0.7) * 0.8
    const magneticForce = magneticBaseForce + magneticPulse // 복합 맥동 자력

    // Uniforms 설정
    const resolutionUniform = gl.getUniformLocation(program, 'u_resolution')
    const mouseUniform = gl.getUniformLocation(program, 'u_mouse')
    const timeUniform = gl.getUniformLocation(program, 'u_time')
    const gravityUniform = gl.getUniformLocation(program, 'u_gravity')
    const magneticForceUniform = gl.getUniformLocation(program, 'u_magneticForce')
    
    gl.uniform2f(resolutionUniform, width, height)
    gl.uniform2f(mouseUniform, mousePositionRef.current.x, mousePositionRef.current.y)
    gl.uniform1f(timeUniform, timeRef.current)
    gl.uniform1f(gravityUniform, gravity)
    gl.uniform1f(magneticForceUniform, magneticForce)

    // Attributes 설정 (Stage 3: 확장된 속성들)
    const positionAttribute = gl.getAttribLocation(program, 'a_position')
    const velocityAttribute = gl.getAttribLocation(program, 'a_velocity')
    const massAttribute = gl.getAttribLocation(program, 'a_mass')
    const metallicAttribute = gl.getAttribLocation(program, 'a_metallic')
    const densityAttribute = gl.getAttribLocation(program, 'a_density')
    const temperatureAttribute = gl.getAttribLocation(program, 'a_temperature')

    // 속성 위치 확인
    if (positionAttribute === -1 || velocityAttribute === -1 || massAttribute === -1 || 
        metallicAttribute === -1 || densityAttribute === -1 || temperatureAttribute === -1) {
      console.error('🔴 Failed to get attribute locations:', {
        position: positionAttribute,
        velocity: velocityAttribute,
        mass: massAttribute,
        metallic: metallicAttribute,
        density: densityAttribute,
        temperature: temperatureAttribute
      })
      return
    }

    // Position buffer
    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.positions, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(positionAttribute)
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0)

    // Velocity buffer
    const velocityBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.velocities, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(velocityAttribute)
    gl.vertexAttribPointer(velocityAttribute, 2, gl.FLOAT, false, 0, 0)

    // Mass buffer
    const massBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, massBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.masses, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(massAttribute)
    gl.vertexAttribPointer(massAttribute, 1, gl.FLOAT, false, 0, 0)

    // Metallic buffer
    const metallicBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, metallicBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.metallics, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(metallicAttribute)
    gl.vertexAttribPointer(metallicAttribute, 1, gl.FLOAT, false, 0, 0)

    // Stage 3: Density buffer
    const densityBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, densityBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.densities, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(densityAttribute)
    gl.vertexAttribPointer(densityAttribute, 1, gl.FLOAT, false, 0, 0)

    // Stage 3: Temperature buffer
    const temperatureBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, temperatureBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, particleData.temperatures, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(temperatureAttribute)
    gl.vertexAttribPointer(temperatureAttribute, 1, gl.FLOAT, false, 0, 0)

    // 파티클 렌더링
    gl.drawArrays(gl.POINTS, 0, particleCount)

    // 버퍼 정리 (Stage 3: 확장된 버퍼들 포함)
    gl.deleteBuffer(positionBuffer)
    gl.deleteBuffer(velocityBuffer)
    gl.deleteBuffer(massBuffer)
    gl.deleteBuffer(metallicBuffer)
    gl.deleteBuffer(densityBuffer)
    gl.deleteBuffer(temperatureBuffer)
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
      y: event.clientY - rect.top
    }
  }, [])

  useEffect(() => {
    console.log('🌊 LiquidMetalParticles 초기화 시작', { width, height, particleCount })
    if (width < 768) {
      console.log('📱 모바일에서 LiquidMetal 비활성화')
      return
    }

    if (!initWebGL()) {
      console.warn('❌ LiquidMetal WebGL 초기화 실패')
      return
    }
    
    console.log('✅ LiquidMetal WebGL 초기화 성공')

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
        opacity: 0.95, // Stage 4: 약간 증가된 투명도로 더 선명한 효과
        mixBlendMode: 'screen', // Stage 4: 스크린 블렌드 모드로 글로우 효과 강화
        filter: 'contrast(1.1) brightness(1.05)', // Stage 4: 대비와 밝기 조정
      }}
    />
  )
}

export default LiquidMetalParticles