import JSZip from 'jszip'
import { RenderError } from './render-types'

/**
 * zip 계열 문서(docx·xlsx·hwpx·pptx)의 압축 폭탄 방어 — 서버 전용.
 *
 * zip 헤더의 `uncompressedSize` 는 파일 안에 적힌 값이라 속일 수 있다(306KB 짜리가 헤더만 100 이고 실제로는 300MB 로 풀리는 식).
 * 그래서 선언 크기를 믿지 않고, 항목을 **스트리밍으로 풀면서 실제 바이트를 센다**. 상한을 넘으면 그 자리에서 멈춘다
 * (전부 푼 뒤에 세지 않는다 — 풀어 놓은 문자열이 곧 메모리다).
 *
 * - `guardZipBuffer`: kordoc 처럼 내부를 고칠 수 없는 변환기 앞에서 중앙 디렉터리를 스트리밍 검사한다(결과는 버린다).
 * - `readZipText`: 우리가 직접 읽는 항목(PPTX 슬라이드)을 상한 안에서만 문자열로 읽는다.
 * 상한을 넘으면 `RenderError('too_large')`. zip 이 아니거나 읽을 수 없는 입력은 여기서 판단하지 않고 변환기에 맡긴다.
 */

/** 압축 해제 총량 상한(바이트) — 사전 검사용. kordoc 자체 상한보다 느슨하게, 메모리 폭주만 막는다 */
export const ZIP_MAX_TOTAL_BYTES = 300 * 1024 * 1024
/** 항목 하나의 해제 상한(바이트) — 사전 검사용(문서 안 이미지 한 장도 이보다 크기 어렵다) */
export const ZIP_MAX_ENTRY_BYTES = 100 * 1024 * 1024
/** 항목 수 상한 */
export const ZIP_MAX_ENTRIES = 20_000
/** 우리가 문자열로 읽는 XML 항목 하나의 상한(바이트) */
export const ZIP_MAX_TEXT_ENTRY_BYTES = 20 * 1024 * 1024

export type ZipLimits = {
  maxTotalBytes?: number
  maxEntryBytes?: number
  maxEntries?: number
}

/** 중앙 디렉터리를 쓰는 zip 계열 확장자(HWP·XLS 는 OLE 라 해당 없음) */
const ZIP_EXT = /\.(docx|xlsx|hwpx|pptx)$/i

function hasZipSignature(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
}

/** JSZip 의 공개 타입에는 없지만 문서화된 스트림 API(StreamHelper) — 청크 단위로 풀고 pause 로 멈출 수 있다 */
type InternalStreamable = {
  internalStream(type: 'uint8array'): {
    on(event: 'data', cb: (chunk: Uint8Array) => void): InternalStream
    on(event: 'error', cb: (e: unknown) => void): InternalStream
    on(event: 'end', cb: () => void): InternalStream
    pause(): InternalStream
    resume(): InternalStream
  }
}
type InternalStream = ReturnType<InternalStreamable['internalStream']>

type StreamEnd = 'end' | 'over' | 'error'

/**
 * 항목 하나를 스트리밍으로 풀며 바이트를 센다. `onChunk` 가 false 를 돌려주면(상한 초과) 즉시 멈추고 'over'.
 * 스트림 오류(헤더 크기 불일치·손상 deflate)는 'error' 로 알린다 — 던지지 않는다.
 */
function streamEntry(
  file: JSZip.JSZipObject,
  onChunk: (chunk: Uint8Array) => boolean
): Promise<StreamEnd> {
  return new Promise<StreamEnd>(resolve => {
    let settled = false
    const done = (ok: StreamEnd) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const stream = (file as unknown as InternalStreamable).internalStream('uint8array')
      stream
        .on('data', (chunk: Uint8Array) => {
          if (settled) return
          if (!onChunk(chunk)) {
            stream.pause() // 더 풀지 않는다
            done('over')
          }
        })
        .on('error', () => done('error'))
        .on('end', () => done('end'))
        .resume()
    } catch {
      done('error')
    }
  })
}

/** 이미 연 zip 의 모든 항목을 스트리밍으로 풀어 실제 해제량이 상한 안인지 확인한다. 넘으면 too_large. */
export async function assertZipWithinLimits(zip: JSZip, limits: ZipLimits = {}): Promise<void> {
  const maxTotal = limits.maxTotalBytes ?? ZIP_MAX_TOTAL_BYTES
  const maxEntry = limits.maxEntryBytes ?? ZIP_MAX_ENTRY_BYTES
  const maxEntries = limits.maxEntries ?? ZIP_MAX_ENTRIES

  const entries = Object.values(zip.files).filter(f => !f.dir)
  if (entries.length > maxEntries) throw new RenderError('too_large')

  let total = 0
  for (const file of entries) {
    let entryBytes = 0
    const end = await streamEntry(file, chunk => {
      entryBytes += chunk.length
      total += chunk.length
      return entryBytes <= maxEntry && total <= maxTotal
    })
    // 'error'(손상·헤더 불일치)는 여기서 판단하지 않는다 — 그때까지 센 양은 total 에 반영됐고, 손상 판정은 변환기 몫
    if (end === 'over') throw new RenderError('too_large')
  }
}

/**
 * zip 계열 문서(확장자로 판단)면 kordoc 에 넘기기 전에 실제 해제량을 검사한다. 해당 없거나 zip 으로 못 열면 그냥 통과
 * (변환기가 자기 방식으로 실패 처리 — 손상 zip 복구 경로는 kordoc 쪽 상한이 따로 지킨다).
 */
export async function guardZipBuffer(
  buffer: Buffer,
  name: string,
  limits: ZipLimits = {}
): Promise<void> {
  if (!ZIP_EXT.test(name) || !hasZipSignature(buffer)) return
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return
  }
  await assertZipWithinLimits(zip, limits)
}

/**
 * 항목 하나를 UTF-8 문자열로 읽는다 — 항목당 `maxEntryBytes`, 호출자가 넘긴 남은 총량 `budget` 을 실제 바이트로 강제한다.
 * 넘으면 too_large. 읽은 바이트 수도 돌려줘 호출자가 총량을 누적한다.
 */
export async function readZipText(
  file: JSZip.JSZipObject,
  budget: number,
  maxEntryBytes: number = ZIP_MAX_TEXT_ENTRY_BYTES
): Promise<{ text: string; bytes: number }> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  const limit = Math.min(budget, maxEntryBytes)
  const end = await streamEntry(file, chunk => {
    bytes += chunk.length
    if (bytes > limit) return false
    chunks.push(chunk)
    return true
  })
  if (end === 'over') throw new RenderError('too_large')
  if (end === 'error') throw new RenderError('corrupt')
  const all = Buffer.concat(chunks)
  return { text: new TextDecoder('utf-8').decode(all), bytes }
}
