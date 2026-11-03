/**
 * "내 PC에서 수정" 보조 저장소(docs/09 §3-1·§5). 브라우저에 남는 것은 파일 핸들뿐이다.
 *  - 파일 핸들(File System Access API): IndexedDB `kw-edit-handles`, 키 = 계보 root id.
 *  - 내가 받은 버전(충돌 판정용 base): localStorage `kw-edit-base:<rootId>`.
 * 소유자: 항목마다 만든 사용자 id 를 함께 저장한다. 현재 사용자(setEditOwner)와 다르면 무시하고 지운다 —
 * 로그아웃 없이 세션만 바뀌어도(계정 전환·만료 후 다른 계정 로그인) 남의 핸들·기준 기록을 쓰지 않는다.
 * 모든 접근을 try/catch 로 감싼다 — 저장소가 막힌 환경(사생활 보호 모드 등)에서는 기능만 조용히 빠진다.
 * 로그아웃 때 clearEditHandles() 로 모두 지운다.
 */

const DB_NAME = 'kw-edit-handles'
const STORE = 'handles'
const BASE_PREFIX = 'kw-edit-base:'

/** lib.dom 에 없는 File System Access API 의 최소 타입 */
export type EditFileHandle = {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<FileSystemWritableLike>
  queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

export type FileSystemWritableLike = WritableStream<Uint8Array> & {
  write: (data: Blob | BufferSource | string) => Promise<void>
  close: () => Promise<void>
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (opts?: {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }) => Promise<EditFileHandle>
}

/** 크롬·엣지 데스크톱에서만 true */
export function supportsFileSystemAccess(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof (window as SavePickerWindow).showSaveFilePicker === 'function'
    )
  } catch {
    return false
  }
}

/** 저장 위치 선택 창. 사용자가 취소하면 null, 지원하지 않거나 실패하면 undefined */
export async function pickSaveHandle(
  suggestedName: string
): Promise<EditFileHandle | null | undefined> {
  const w = window as SavePickerWindow
  if (typeof w.showSaveFilePicker !== 'function') return undefined
  try {
    return await w.showSaveFilePicker({ suggestedName })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    return undefined
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(STORE)
        } catch {
          // 이미 있음
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    db =>
      new Promise<T | null>(resolve => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const req = fn(tx.objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          tx.oncomplete = () => db.close()
          tx.onabort = () => {
            db.close()
            resolve(null)
          }
        } catch {
          try {
            db.close()
          } catch {
            // 무시
          }
          resolve(null)
        }
      })
  )
}

let currentOwner: string | null = null

/**
 * 현재 로그인 사용자를 알린다(버전 상태를 읽을 때 호출). 다른 사용자가 남긴 항목은 이때 한 번 쓸어 낸다.
 * 알리기 전(null)에는 어떤 항목도 읽지 않는다.
 */
export function setEditOwner(userId: string | null): void {
  if (currentOwner === userId) return
  currentOwner = userId
  if (userId) void sweepForeignEntries(userId)
}

type StoredHandle = { owner: string; handle: EditFileHandle }

function isStoredHandle(v: unknown): v is StoredHandle {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as StoredHandle).owner === 'string' &&
    typeof (v as StoredHandle).handle?.getFile === 'function'
  )
}

async function sweepForeignEntries(userId: string): Promise<void> {
  try {
    const db = await openDb()
    if (db) {
      await new Promise<void>(resolve => {
        try {
          const tx = db.transaction(STORE, 'readwrite')
          const req = tx.objectStore(STORE).openCursor()
          req.onsuccess = () => {
            const cursor = req.result
            if (!cursor) return
            if (!isStoredHandle(cursor.value) || cursor.value.owner !== userId) cursor.delete()
            cursor.continue()
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onabort = () => {
            db.close()
            resolve()
          }
        } catch {
          db.close()
          resolve()
        }
      })
    }
  } catch {
    // 무시
  }
  try {
    const stale: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k?.startsWith(BASE_PREFIX)) continue
      if (readBase(k)?.owner !== userId) stale.push(k)
    }
    for (const k of stale) window.localStorage.removeItem(k)
  } catch {
    // 저장소가 막힌 환경
  }
}

export async function saveEditHandle(rootId: string, handle: EditFileHandle): Promise<boolean> {
  if (!currentOwner) return false
  try {
    const value: StoredHandle = { owner: currentOwner, handle }
    const res = await run('readwrite', s => s.put(value, rootId))
    return res !== null
  } catch {
    return false
  }
}

export async function loadEditHandle(rootId: string): Promise<EditFileHandle | null> {
  if (!currentOwner) return null
  try {
    const res = await run<unknown>('readonly', s => s.get(rootId))
    if (res === null || res === undefined) return null
    if (isStoredHandle(res) && res.owner === currentOwner) return res.handle
    // 다른 사용자(또는 소유자 기록이 없던 옛 형식)의 핸들 — 쓰지 않고 지운다
    await deleteEditHandle(rootId)
    return null
  } catch {
    return null
  }
}

export async function deleteEditHandle(rootId: string): Promise<void> {
  try {
    await run('readwrite', s => s.delete(rootId))
  } catch {
    // 무시
  }
}

/** 로그아웃 시 — 핸들과 받은 버전 기록을 모두 지운다 */
export async function clearEditHandles(): Promise<void> {
  try {
    await run('readwrite', s => s.clear())
  } catch {
    // 무시
  }
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k?.startsWith(BASE_PREFIX)) keys.push(k)
    }
    for (const k of keys) window.localStorage.removeItem(k)
  } catch {
    // 저장소가 막힌 환경
  }
}

function readBase(key: string): { baseId: string; owner: string | null } | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { baseId?: unknown; u?: unknown } | null
    if (typeof parsed?.baseId !== 'string') return null
    return { baseId: parsed.baseId, owner: typeof parsed.u === 'string' ? parsed.u : null }
  } catch {
    return null
  }
}

/** 내가 받은 버전(충돌 판정의 base) 기록 */
export function saveEditBase(rootId: string, baseAttachmentId: string): void {
  if (!currentOwner) return
  try {
    window.localStorage.setItem(
      `${BASE_PREFIX}${rootId}`,
      JSON.stringify({ baseId: baseAttachmentId, u: currentOwner, t: Date.now() })
    )
  } catch {
    // 저장소가 막힌 환경 — base 를 모르면 열어 본 버전을 쓴다
  }
}

export function loadEditBase(rootId: string): string | null {
  if (!currentOwner) return null
  const key = `${BASE_PREFIX}${rootId}`
  const base = readBase(key)
  if (!base) return null
  if (base.owner !== currentOwner) {
    // 다른 사용자(또는 소유자 기록 없는 옛 형식)의 기록 — 쓰지 않고 지운다
    deleteEditBase(rootId)
    return null
  }
  return base.baseId
}

export function deleteEditBase(rootId: string): void {
  try {
    window.localStorage.removeItem(`${BASE_PREFIX}${rootId}`)
  } catch {
    // 무시
  }
}

/** 수정 상태가 바뀌었음을 같은 탭의 여러 컴포넌트(컨트롤·목록 패널)에 알린다 */
export const EDIT_CHANGED_EVENT = 'kw-file-edit-changed'

export function notifyEditChanged(): void {
  try {
    window.dispatchEvent(new Event(EDIT_CHANGED_EVENT))
  } catch {
    // 무시
  }
}
