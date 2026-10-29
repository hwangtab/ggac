import { z } from 'zod'

/**
 * 사용자 입력 배열을 zod 로 검사할 때 쓰는 "길이 먼저" 스키마.
 *
 * zod 3 의 `z.array(x).max(N)` 은 원소를 끝까지 파싱한 뒤에야 길이 초과를 보고한다
 * (GHSA-mrhx-c7xc-m3w5 — 1MB 요청 하나로 힙이 약 195MB 까지 커진다). 여기서는 원소를 건드리기 **전에**
 * `Array.isArray(raw) && raw.length <= max` 를 보고, 넘으면 원소 검사 없이 바로 이슈를 남긴다.
 * 중첩 배열도 단계마다 이 스키마를 쓰면 각 단계가 먼저 걸러진다.
 *
 * ggac 이식: ggac 는 zod 4 다. 원본(zod 3)의 `ZodTypeDef` 제네릭·이슈 모양(`received`·`type`)을 zod 4 의
 * `ZodType<Output, Input>`·`origin`/`input` 으로 바꿨다. 동작(길이를 먼저 보고 넘으면 원소를 순회하지 않음)은 같다 —
 * zod 4 의 pipe 도 앞 단계에 이슈가 있으면 뒤 단계를 돌리지 않는다.
 */
export function boundedArray<T extends z.ZodType>(
  item: T,
  opts: { max: number; min?: number; maxMessage?: string; minMessage?: string }
): z.ZodType<z.output<T>[], z.input<T>[]> {
  const { max, min, maxMessage, minMessage } = opts
  const gate = z.unknown().superRefine((raw, ctx) => {
    if (!Array.isArray(raw)) {
      ctx.addIssue({ code: 'invalid_type', expected: 'array', input: raw })
      return
    }
    if (raw.length > max) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: max,
        inclusive: true,
        input: raw,
        ...(maxMessage ? { message: maxMessage } : {}),
      })
    }
  })
  let inner = z.array(item)
  if (min !== undefined) inner = inner.min(min, minMessage)
  inner = inner.max(max, maxMessage)
  return gate.pipe(inner) as unknown as z.ZodType<z.output<T>[], z.input<T>[]>
}
