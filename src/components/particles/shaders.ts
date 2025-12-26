/**
 * LiquidMetalParticles WebGL 2.0 셰이더 소스코드
 *
 * 이 파일은 WebGL 2.0 Transform Feedback을 사용한 파티클 시뮬레이션 셰이더를 포함합니다.
 * - 업데이트 셰이더: 파티클 물리 시뮬레이션
 * - 렌더링 셰이더: 메탈릭 효과 렌더링
 */

// ============================================
// 파티클 업데이트용 Vertex Shader (Transform Feedback)
// ============================================
export const UPDATE_VERTEX_SHADER_SOURCE = `#version 300 es
precision mediump float;

// 입력 속성 (현재 파티클 상태)
in vec2 a_position;
in vec2 a_velocity;
in float a_mass;
in float a_metallic;
in float a_density;
in float a_temperature;

// 유니폼 (전역 파라미터)
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;
uniform float u_gravity;
uniform float u_magneticForce;
uniform float u_deltaTime;

// Transform Feedback 출력 (업데이트된 파티클 상태)
out vec2 out_position;
out vec2 out_velocity;
out float out_mass;
out float out_metallic;
out float out_density;
out float out_temperature;

// 노이즈 함수
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
  
  // 개선된 자력 시스템 - 파티클 분산 유지
  float nearFieldRange = 60.0;
  float farFieldRange = 180.0;
  
  vec2 magneticDir = normalize(toMouse + vec2(0.001));
  float farMask = 1.0 - step(farFieldRange, distToMouse);
  
  float nearFactor = 1.0 - (distToMouse / nearFieldRange);
  float nearStrength = pow(max(nearFactor, 0.0), 3.0) * u_magneticForce * 0.8;
  
  float farFactor = 1.0 - ((distToMouse - nearFieldRange) / (farFieldRange - nearFieldRange));
  float farStrength = max(farFactor, 0.0) * u_magneticForce * 0.15;
  
  float nearMask = 1.0 - step(nearFieldRange, distToMouse);
  float magneticStrength = nearMask * nearStrength + (1.0 - nearMask) * farStrength;
  
  // 분산력 추가 - 파티클들이 서로 밀어내는 힘
  float repulsionRange = 40.0;
  float repulsionMask = 1.0 - step(repulsionRange, distToMouse);
  float repulsionStrength = pow(1.0 - (distToMouse / repulsionRange), 2.0) * 0.3;
  vec2 repulsionDir = -magneticDir;
  
  // 자력과 분산력 조합
  float massEffect = 2.0 - a_mass;
  vel += magneticDir * magneticStrength * massEffect * farMask * u_deltaTime;
  vel += repulsionDir * repulsionStrength * massEffect * repulsionMask * u_deltaTime;
  
  // 개선된 중력 시스템 - 분산 유지
  float terminalVelocity = 10.0;
  float gravityEffect = u_gravity * a_mass * 0.5;
  float currentSpeed = length(vel);
  float airResistance = min(currentSpeed / terminalVelocity, 1.0);
  gravityEffect *= (1.0 - airResistance * 0.6);
  
  // 부유력 추가 - 파티클들이 떠다니는 효과
  float buoyancy = sin(u_time * 0.8 + pos.x * 0.02) * 0.8;
  gravityEffect += buoyancy;
  
  vel.y += gravityEffect * u_deltaTime;
  
  // 개선된 점성 및 흐름 시스템 - 순환 패턴으로 분산 촉진
  float timeFlow = u_time * 0.2;
  float viscosityNoise = smoothNoise(pos * 0.005 + vec2(timeFlow, 0.0));
  float viscosityStrength = viscosityNoise * 4.0 + 1.0;
  
  // 순환 패턴 추가 - 와류 효과로 자연스러운 분산
  float vortexX = cos(u_time * 0.4 + pos.y * 0.01) * 2.0;
  float vortexY = sin(u_time * 0.4 + pos.x * 0.01) * 2.0;
  
  float horizontalFlow = sin(timeFlow + pos.y * 0.005) * viscosityStrength + vortexX;
  vel.x += horizontalFlow * u_deltaTime;
  
  float verticalTurbulence = smoothNoise(vec2(pos.x * 0.008, u_time * 0.15)) * 2.0 + vortexY;
  vel.y += verticalTurbulence * u_deltaTime;
  
  // 위치 업데이트
  pos += vel * u_deltaTime;
  
  // 경계 처리
  float poolDepth = 60.0;
  float poolSurface = u_resolution.y - poolDepth;
  float poolMask = step(poolSurface, pos.y);
  
  float submersionDepth = clamp((pos.y - poolSurface) / poolDepth, 0.0, 1.0);
  float poolFlow = sin(u_time * 1.5 + pos.x * 0.05) * (5.0 + submersionDepth * 10.0);
  vel.x += poolFlow * poolMask * u_deltaTime;
  
  float surfaceMask = 1.0 - step(0.2, submersionDepth);
  float surfaceTension = sin(u_time * 4.0 + pos.x * 0.1) * 2.0;
  vel.y += surfaceTension * (1.0 - submersionDepth * 5.0) * surfaceMask * poolMask * u_deltaTime;
  
  pos.y = mix(pos.y, min(pos.y, u_resolution.y - 10.0), poolMask);
  
  // 수평 경계 처리
  float edgeBuffer = 30.0;
  float leftMask = step(pos.x, -edgeBuffer);
  float rightMask = step(u_resolution.x + edgeBuffer, pos.x);
  
  pos.x = mix(pos.x, u_resolution.x + edgeBuffer, leftMask);
  pos.x = mix(pos.x, -edgeBuffer, rightMask);
  
  // 상단 경계
  pos.y = max(pos.y, 0.0);
  
  // 속도 감쇠 (에너지 보존)
  vel *= 0.99;
  
  // Transform Feedback 출력
  out_position = pos;
  out_velocity = vel;
  out_mass = a_mass;
  out_metallic = a_metallic;
  out_density = a_density;
  out_temperature = a_temperature;
  
  // Transform Feedback에서는 gl_Position이 여전히 필요하지만 사용되지 않음
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}
`

// ============================================
// 파티클 업데이트용 Fragment Shader (더미)
// ============================================
export const UPDATE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() {
  // Transform Feedback에서는 실제로 사용되지 않는 더미 셰이더
  fragColor = vec4(0.0, 0.0, 0.0, 0.0);
}
`

// ============================================
// 파티클 렌더링용 Vertex Shader
// ============================================
export const RENDER_VERTEX_SHADER_SOURCE = `#version 300 es
precision mediump float;

// 입력 속성 (Transform Feedback으로부터)
in vec2 a_position;
in vec2 a_velocity;
in float a_mass;
in float a_metallic;
in float a_density;
in float a_temperature;

// 유니폼
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;

// Fragment shader로 전달
out float v_metallic;
out vec2 v_velocity;
out float v_distanceToMouse;
out float v_density;
out float v_temperature;

void main() {
  vec2 pos = a_position;
  
  // 마우스와의 거리 계산
  vec2 mousePos = u_mouse;
  vec2 toMouse = mousePos - pos;
  float distToMouse = length(toMouse);
  v_distanceToMouse = distToMouse;
  
  // 화면 좌표계로 변환
  vec2 position = (pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(position * vec2(1, -1), 0, 1);
  
  // 동적 크기 계산
  float baseSizeMultiplier = a_metallic * 0.8 + 0.4;
  float mouseEffect = 1.0 - min(distToMouse / 120.0, 1.0);
  mouseEffect = pow(mouseEffect, 1.5) * 2.5;
  
  float velocityMagnitude = length(a_velocity);
  float motionStretch = 1.0 + min(velocityMagnitude / 8.0, 0.8);
  float densityEffect = 0.8 + (a_density - 1.0) * 0.4;
  float thermalExpansion = 1.0 + (a_temperature - 0.5) * 0.3;
  
  float timeVariation = sin(u_time * 2.0 + distToMouse * 0.1) * 0.1 + 1.0;
  float holographicPulse = 1.0 + sin(u_time * 3.0 + a_metallic * 10.0) * a_metallic * 0.15;
  
  float finalSize = (6.0 + baseSizeMultiplier * 4.0 + mouseEffect) * 
                    motionStretch * densityEffect * thermalExpansion * 
                    timeVariation * holographicPulse;
  
  gl_PointSize = clamp(finalSize, 3.0, 40.0);
  
  v_metallic = a_metallic;
  v_velocity = a_velocity;
  v_density = a_density;
  v_temperature = a_temperature;
}
`

// ============================================
// 파티클 렌더링용 Fragment Shader (메탈릭 효과)
// ============================================
export const RENDER_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

// 입력
in float v_metallic;
in vec2 v_velocity;
in float v_distanceToMouse;
in float v_density;
in float v_temperature;

// 유니폼
uniform float u_time;

// 출력
out vec4 fragColor;

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
  
  // 원형 파티클
  float circleMask = 1.0 - step(0.5, distance);
  
  // 메탈릭 색상 시스템
  vec3 chromiumBase = vec3(0.55, 0.56, 0.67);
  vec3 chromiumHighlight = vec3(0.95, 0.95, 1.0);
  vec3 chromiumDark = vec3(0.1, 0.12, 0.15);
  
  vec3 aluminumBase = vec3(0.91, 0.92, 0.92);
  vec3 aluminumHighlight = vec3(1.0, 1.0, 1.0);
  vec3 aluminumDark = vec3(0.4, 0.42, 0.44);
  
  float edgeFactor = 1.0 - distance * 2.0;
  float fresnel = pow(1.0 - edgeFactor, 1.8);
  
  vec3 baseColor = mix(chromiumBase, aluminumBase, v_metallic);
  vec3 highlightColor = mix(chromiumHighlight, aluminumHighlight, v_metallic);
  vec3 darkColor = mix(chromiumDark, aluminumDark, v_metallic);
  
  // 온도 효과
  float temperatureFactor = v_temperature;
  vec3 heatTint = vec3(1.0, 0.6, 0.3) * temperatureFactor * 0.2;
  baseColor += heatTint;
  
  // 표면 노이즈
  float surfaceNoise = smoothNoise(coord * 15.0 + u_time * 0.5);
  
  // 환경 반사
  float envRotation = u_time * 0.2;
  vec2 envCoord = vec2(
    coord.x * cos(envRotation) - coord.y * sin(envRotation),
    coord.x * sin(envRotation) + coord.y * cos(envRotation)
  );
  float envReflection = smoothNoise(envCoord * 8.0 + vec2(u_time * 0.3, 0.0));
  
  vec3 primaryReflection = mix(darkColor, baseColor, edgeFactor);
  vec3 secondaryReflection = mix(baseColor, highlightColor, fresnel);
  vec3 environmentReflection = mix(primaryReflection, secondaryReflection, envReflection * 0.7);
  
  // 마우스 글로우
  float mouseInfluence = 1.0 - min(v_distanceToMouse / 120.0, 1.0);
  vec3 coreGlow = vec3(0.2, 0.4, 0.9) * mouseInfluence * 0.6;
  vec3 rimGlow = vec3(0.9, 0.7, 0.3) * mouseInfluence * 0.3;
  vec3 energyGlow = coreGlow + rimGlow * fresnel;
  
  // 시머 효과
  float timeShimmer = sin(u_time * 4.0 + v_distanceToMouse * 0.08 + surfaceNoise * 3.14) * 0.15 + 0.85;
  float metallicShimmer = sin(u_time * 2.5 + distance * 10.0) * v_metallic * 0.1 + 0.9;
  
  // 홀로그래픽 효과
  float holographicShift = sin(atan(coord.y, coord.x) * 3.0 + u_time * 1.5) * 0.1;
  vec3 holographicTint = vec3(
    0.5 + sin(u_time * 0.7 + distance * 5.0) * 0.2,
    0.5 + sin(u_time * 0.9 + distance * 7.0) * 0.2,
    0.5 + sin(u_time * 1.1 + distance * 6.0) * 0.2
  ) * v_metallic * holographicShift;
  
  // 최종 색상
  vec3 metallicSurface = (environmentReflection + holographicTint) * timeShimmer * metallicShimmer;
  vec3 finalColor = metallicSurface + energyGlow;
  
  // HDR 톤 매핑
  finalColor = finalColor * (finalColor * 2.51 + 0.03) / (finalColor * (finalColor * 2.43 + 0.59) + 0.14);
  finalColor = pow(finalColor, vec3(0.85));
  
  // 단순화된 투명도
  float baseAlpha = edgeFactor * (0.9 + v_metallic * 0.1);
  float energyAlpha = 1.0 + mouseInfluence * 0.4;
  float alpha = baseAlpha * energyAlpha * 0.95;
  
  fragColor = vec4(finalColor, alpha * circleMask);
}
`
