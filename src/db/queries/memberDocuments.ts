/**
 * 조합원 내 문서함 쿼리 계층(Turso/Drizzle) — docs/board-work/04-조합원-문서함.md §2·§5·§6.
 *
 * 이 모듈은 **권한을 모른다**(`NextResponse`·`next/headers`·인가 임포트 금지). 대신 **소유 경계를 데이터 규칙으로**
 * 지킨다: 문서·버전·임시 업로드를 읽고 쓰는 함수는 전부 `ownerId`를 인자로 받아 WHERE 에 넣는다 — 남의 id 를 넣으면
 * 없는 id 와 똑같이 null·false 다. `ownerId`는 라우트가 `requireActiveMember()`로 확정한 사용자 id 여야 한다.
 * 보존 크론 함수(`listRetention*`·`markDeletionNotified`·`deleteExpiredDocument`·`listExpiredPendingUploads`)만 소유자를
 * 가리지 않는다(크론 전용 — 라우트가 부르지 않는다).
 *
 * 응답은 snake_case 가 아니라 화면 전용 camelCase 다(이 영역은 옛 Supabase 응답 모양을 이어받지 않았다).
 */

import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { memberDocumentUploads, memberDocumentVersions, memberDocuments } from '../schema/index.ts'
import {
  MEMBER_DOCUMENT_GRACE_MS,
  MEMBER_DOCUMENT_IDLE_MS,
  MEMBER_DOCUMENT_PENDING_TTL_MS,
  quotaVerdict,
  type MemberDocumentSource,
} from '../../lib/memberDocuments/rules.ts'

export type MemberDocumentVersionRow = {
  id: string
  documentId: string
  versionNo: number
  name: string
  mime: string
  size: number
  blobPath: string
  source: string
  createdAt: Date
}

export type MemberDocumentRow = {
  id: string
  ownerId: string
  name: string
  latestVersionNo: number
  lastOpenedAt: Date
  deletionNotifiedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type MemberDocumentListItem = MemberDocumentRow & {
  latestVersionId: string
  mime: string
  /** 최신 버전 크기 */
  size: number
  /** 모든 버전 크기 합(사용량에 들어가는 몫) */
  totalSize: number
  versionCount: number
}

export type MemberDocumentPendingRow = {
  id: string
  ownerId: string
  documentId: string | null
  blobPath: string
  name: string
  mime: string
  size: number
  createdAt: Date
}

/** 쓰기 거절 — 라우트가 상태 코드로 바꾼다 */
export class MemberDocumentWriteError extends Error {
  // node --test(strip-only)는 매개변수 속성을 읽지 못한다 — 필드를 따로 둔다
  readonly code: 'not_found' | 'conflict' | 'quota' | 'too_many'
  constructor(code: 'not_found' | 'conflict' | 'quota' | 'too_many', message: string) {
    super(message)
    this.code = code
    this.name = 'MemberDocumentWriteError'
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

function pendingCutoff(now: Date): Date {
  return new Date(now.getTime() - MEMBER_DOCUMENT_PENDING_TTL_MS)
}

// ── 사용량 ────────────────────────────────────────────────────────────────────

export type MemberDocumentUsage = {
  /** 모든 버전 크기 합 */
  stored: number
  /** 24시간 안의 임시 업로드가 알린 크기 합 */
  pending: number
  total: number
}

async function usageWith(
  ex: Executor,
  ownerId: string,
  now: Date,
  excludeUploadId?: string
): Promise<MemberDocumentUsage> {
  const [stored] = await ex
    .select({ n: sql<number>`coalesce(sum(${memberDocumentVersions.size}), 0)` })
    .from(memberDocumentVersions)
    .where(eq(memberDocumentVersions.ownerId, ownerId))
  const pendingWhere = [
    eq(memberDocumentUploads.ownerId, ownerId),
    gt(memberDocumentUploads.createdAt, pendingCutoff(now)),
  ]
  if (excludeUploadId) pendingWhere.push(sql`${memberDocumentUploads.id} <> ${excludeUploadId}`)
  const [pending] = await ex
    .select({ n: sql<number>`coalesce(sum(${memberDocumentUploads.size}), 0)` })
    .from(memberDocumentUploads)
    .where(and(...pendingWhere))
  const s = Number(stored?.n ?? 0)
  const p = Number(pending?.n ?? 0)
  return { stored: s, pending: p, total: s + p }
}

/** 내 사용량. `excludeUploadId`는 승격 중인 임시 업로드(자기 몫을 두 번 세지 않게) */
export function getMemberDocumentUsage(
  ownerId: string,
  now: Date = new Date(),
  excludeUploadId?: string
): Promise<MemberDocumentUsage> {
  return usageWith(db, ownerId, now, excludeUploadId)
}

export async function countMemberDocuments(ownerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(memberDocuments)
    .where(eq(memberDocuments.ownerId, ownerId))
  return Number(row?.n ?? 0)
}

// ── 읽기 ──────────────────────────────────────────────────────────────────────

function toDocumentRow(r: typeof memberDocuments.$inferSelect): MemberDocumentRow {
  return {
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    latestVersionNo: r.latestVersionNo,
    lastOpenedAt: r.lastOpenedAt,
    deletionNotifiedAt: r.deletionNotifiedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function toVersionRow(r: typeof memberDocumentVersions.$inferSelect): MemberDocumentVersionRow {
  return {
    id: r.id,
    documentId: r.documentId,
    versionNo: r.versionNo,
    name: r.name,
    mime: r.mime,
    size: r.size,
    blobPath: r.blobPath,
    source: r.source,
    createdAt: r.createdAt,
  }
}

/** 내 문서 목록(최근 고친 순). 최신 버전 id·형식·크기와 모든 버전 크기 합을 함께 */
export async function listMemberDocuments(ownerId: string): Promise<MemberDocumentListItem[]> {
  const docs = await db
    .select()
    .from(memberDocuments)
    .where(eq(memberDocuments.ownerId, ownerId))
    .orderBy(desc(memberDocuments.updatedAt), desc(memberDocuments.createdAt))
  if (docs.length === 0) return []
  const versions = await db
    .select()
    .from(memberDocumentVersions)
    .where(
      and(
        eq(memberDocumentVersions.ownerId, ownerId),
        inArray(
          memberDocumentVersions.documentId,
          docs.map(d => d.id)
        )
      )
    )
  const byDoc = new Map<string, (typeof memberDocumentVersions.$inferSelect)[]>()
  for (const v of versions) {
    const list = byDoc.get(v.documentId) ?? []
    list.push(v)
    byDoc.set(v.documentId, list)
  }
  const out: MemberDocumentListItem[] = []
  for (const d of docs) {
    const list = byDoc.get(d.id) ?? []
    const latest = list.find(v => v.versionNo === d.latestVersionNo)
    if (!latest) continue // 버전 없는 문서는 쓰기 함수가 만들지 않는다 — 보이지 않게만 한다
    out.push({
      ...toDocumentRow(d),
      latestVersionId: latest.id,
      mime: latest.mime,
      size: latest.size,
      totalSize: list.reduce((n, v) => n + v.size, 0),
      versionCount: list.length,
    })
  }
  return out
}

/** 내 문서 하나 + 버전들(최신 먼저). 남의 문서·없는 문서는 null */
export async function getOwnedMemberDocument(
  ownerId: string,
  documentId: string
): Promise<{ document: MemberDocumentRow; versions: MemberDocumentVersionRow[] } | null> {
  const [doc] = await db
    .select()
    .from(memberDocuments)
    .where(and(eq(memberDocuments.id, documentId), eq(memberDocuments.ownerId, ownerId)))
    .limit(1)
  if (!doc) return null
  const versions = await db
    .select()
    .from(memberDocumentVersions)
    .where(
      and(
        eq(memberDocumentVersions.documentId, doc.id),
        eq(memberDocumentVersions.ownerId, ownerId)
      )
    )
    .orderBy(desc(memberDocumentVersions.versionNo))
  return { document: toDocumentRow(doc), versions: versions.map(toVersionRow) }
}

/** 내 버전 하나 + 그 문서. 남의 버전·없는 버전은 null */
export async function getOwnedMemberDocumentVersion(
  ownerId: string,
  versionId: string
): Promise<{ version: MemberDocumentVersionRow; document: MemberDocumentRow } | null> {
  const [row] = await db
    .select({ v: memberDocumentVersions, d: memberDocuments })
    .from(memberDocumentVersions)
    .innerJoin(memberDocuments, eq(memberDocuments.id, memberDocumentVersions.documentId))
    .where(
      and(
        eq(memberDocumentVersions.id, versionId),
        eq(memberDocumentVersions.ownerId, ownerId),
        eq(memberDocuments.ownerId, ownerId)
      )
    )
    .limit(1)
  if (!row) return null
  return { version: toVersionRow(row.v), document: toDocumentRow(row.d) }
}

/** 열었다(상세·내려받기·편집기) — 보존 시계를 처음부터 다시 센다(알림도 거둔다). 남의 문서는 false */
export async function touchOwnedMemberDocument(
  ownerId: string,
  documentId: string,
  now: Date = new Date()
): Promise<boolean> {
  const res = await db
    .update(memberDocuments)
    .set({ lastOpenedAt: now, deletionNotifiedAt: null })
    .where(and(eq(memberDocuments.id, documentId), eq(memberDocuments.ownerId, ownerId)))
    .returning({ id: memberDocuments.id })
  return res.length === 1
}

// ── 임시 업로드 ───────────────────────────────────────────────────────────────

/**
 * 임시 업로드 행을 만든다 — 사용량(모든 버전 + 24시간 안의 임시 업로드 + 이번 크기 ≤ 상한)과 동시 임시 업로드 수를
 * **같은 트랜잭션 안에서** 다시 센다(동시 요청 둘이 사전 검사를 함께 통과한 경우). 넘으면 MemberDocumentWriteError.
 * `documentId`가 있으면 그 문서가 내 것이어야 한다(아니면 not_found).
 */
export async function insertMemberDocumentUpload(
  row: Omit<MemberDocumentPendingRow, 'createdAt'>,
  opts: { maxPending: number; quotaBytes?: number; now?: Date }
): Promise<void> {
  const now = opts.now ?? new Date()
  await db.transaction(async tx => {
    if (row.documentId) {
      const [doc] = await tx
        .select({ id: memberDocuments.id })
        .from(memberDocuments)
        .where(
          and(eq(memberDocuments.id, row.documentId), eq(memberDocuments.ownerId, row.ownerId))
        )
        .limit(1)
      if (!doc) throw new MemberDocumentWriteError('not_found', '문서를 찾을 수 없습니다.')
    }
    const [pending] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(memberDocumentUploads)
      .where(
        and(
          eq(memberDocumentUploads.ownerId, row.ownerId),
          gt(memberDocumentUploads.createdAt, pendingCutoff(now))
        )
      )
    if (Number(pending?.n ?? 0) >= opts.maxPending) {
      throw new MemberDocumentWriteError(
        'too_many',
        '올리는 중인 파일이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
      )
    }
    const usage = await usageWith(tx, row.ownerId, now)
    if (!quotaVerdict(usage.total, row.size, opts.quotaBytes).ok) {
      throw new MemberDocumentWriteError('quota', '용량을 넘습니다.')
    }
    await tx.insert(memberDocumentUploads).values({ ...row, createdAt: now })
  })
}

/** 내 임시 업로드(24시간 안). 남의 것·만료된 것·없는 것은 null */
export async function getOwnedMemberDocumentUpload(
  ownerId: string,
  uploadId: string,
  now: Date = new Date()
): Promise<MemberDocumentPendingRow | null> {
  const [row] = await db
    .select()
    .from(memberDocumentUploads)
    .where(
      and(
        eq(memberDocumentUploads.id, uploadId),
        eq(memberDocumentUploads.ownerId, ownerId),
        gt(memberDocumentUploads.createdAt, pendingCutoff(now))
      )
    )
    .limit(1)
  return row ? { ...row, documentId: row.documentId ?? null } : null
}

/** 내 임시 업로드 행을 지운다(객체는 호출자가). 지운 행 또는 null */
export async function deleteOwnedMemberDocumentUpload(
  ownerId: string,
  uploadId: string
): Promise<MemberDocumentPendingRow | null> {
  const [row] = await db
    .delete(memberDocumentUploads)
    .where(and(eq(memberDocumentUploads.id, uploadId), eq(memberDocumentUploads.ownerId, ownerId)))
    .returning()
  return row ? { ...row, documentId: row.documentId ?? null } : null
}

// ── 승격(새 문서·새 버전·되돌리기) ────────────────────────────────────────────

type VersionInput = {
  id: string
  name: string
  mime: string
  size: number
  blobPath: string
  source: MemberDocumentSource
}

async function takeUpload(
  tx: Tx,
  ownerId: string,
  uploadId: string,
  documentId: string | null
): Promise<void> {
  const res = await tx
    .delete(memberDocumentUploads)
    .where(
      and(
        eq(memberDocumentUploads.id, uploadId),
        eq(memberDocumentUploads.ownerId, ownerId),
        documentId === null
          ? isNull(memberDocumentUploads.documentId)
          : eq(memberDocumentUploads.documentId, documentId)
      )
    )
    .returning({ id: memberDocumentUploads.id })
  if (res.length !== 1) {
    throw new MemberDocumentWriteError(
      'not_found',
      '올린 파일을 찾을 수 없습니다. 다시 올려 주세요.'
    )
  }
}

/**
 * 임시 업로드 → 새 문서 v1. 임시 행을 지우고(같은 업로드로 두 번 만들지 못한다) 문서·버전을 만든다.
 * 사용량은 이 업로드를 뺀 나머지 + 실제 크기로 다시 본다.
 */
export async function createMemberDocumentFromUpload(input: {
  ownerId: string
  uploadId: string
  version: Omit<VersionInput, 'id'>
  maxDocuments: number
  quotaBytes?: number
  now?: Date
}): Promise<{ documentId: string; versionId: string }> {
  const now = input.now ?? new Date()
  return db.transaction(async tx => {
    const [count] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(memberDocuments)
      .where(eq(memberDocuments.ownerId, input.ownerId))
    if (Number(count?.n ?? 0) >= input.maxDocuments) {
      throw new MemberDocumentWriteError('too_many', '문서 수가 상한에 닿았습니다.')
    }
    const usage = await usageWith(tx, input.ownerId, now, input.uploadId)
    if (!quotaVerdict(usage.total, input.version.size, input.quotaBytes).ok) {
      throw new MemberDocumentWriteError('quota', '용량을 넘습니다.')
    }
    await takeUpload(tx, input.ownerId, input.uploadId, null)
    const documentId = crypto.randomUUID()
    await tx.insert(memberDocuments).values({
      id: documentId,
      ownerId: input.ownerId,
      name: input.version.name,
      latestVersionNo: 1,
      lastOpenedAt: now,
      deletionNotifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    // 열을 하나씩 적는다 — 호출자가 넘긴 객체에 다른 키(id·documentId·ownerId)가 섞여 와도 덮어쓰지 못하게
    await tx.insert(memberDocumentVersions).values({
      id: input.uploadId,
      documentId,
      ownerId: input.ownerId,
      versionNo: 1,
      name: input.version.name,
      mime: input.version.mime,
      size: input.version.size,
      blobPath: input.version.blobPath,
      source: input.version.source,
      createdAt: now,
    })
    return { documentId, versionId: input.uploadId }
  })
}

/**
 * 내 문서에 새 버전을 더한다 — 업로드 승격(`uploadId`) 또는 되돌리기 복사본(`uploadId` 없음, 서버가 만든 객체).
 * `baseVersionNo`를 주면 그 번호가 지금 최신이어야 한다(다른 탭에서 먼저 저장했으면 conflict).
 * 문서의 이름·최신 번호·고친 때를 바꾸고 보존 시계를 처음부터 다시 센다.
 */
export async function addMemberDocumentVersion(input: {
  ownerId: string
  documentId: string
  uploadId: string | null
  baseVersionNo: number | null
  version: VersionInput
  quotaBytes?: number
  now?: Date
}): Promise<{ versionId: string; versionNo: number }> {
  const now = input.now ?? new Date()
  return db.transaction(async tx => {
    const [doc] = await tx
      .select()
      .from(memberDocuments)
      .where(
        and(eq(memberDocuments.id, input.documentId), eq(memberDocuments.ownerId, input.ownerId))
      )
      .limit(1)
    if (!doc) throw new MemberDocumentWriteError('not_found', '문서를 찾을 수 없습니다.')
    if (input.baseVersionNo !== null && input.baseVersionNo !== doc.latestVersionNo) {
      throw new MemberDocumentWriteError(
        'conflict',
        `다른 곳에서 먼저 v${doc.latestVersionNo}을 저장했습니다. 새로 연 뒤 다시 저장해 주세요.`
      )
    }
    const usage = await usageWith(tx, input.ownerId, now, input.uploadId ?? undefined)
    if (!quotaVerdict(usage.total, input.version.size, input.quotaBytes).ok) {
      throw new MemberDocumentWriteError('quota', '용량을 넘습니다.')
    }
    if (input.uploadId) await takeUpload(tx, input.ownerId, input.uploadId, input.documentId)
    const versionNo = doc.latestVersionNo + 1
    await tx.insert(memberDocumentVersions).values({
      id: input.version.id,
      documentId: doc.id,
      ownerId: input.ownerId,
      versionNo,
      name: input.version.name,
      mime: input.version.mime,
      size: input.version.size,
      blobPath: input.version.blobPath,
      source: input.version.source,
      createdAt: now,
    })
    await tx
      .update(memberDocuments)
      .set({
        latestVersionNo: versionNo,
        name: input.version.name,
        updatedAt: now,
        lastOpenedAt: now,
        deletionNotifiedAt: null,
      })
      .where(and(eq(memberDocuments.id, doc.id), eq(memberDocuments.ownerId, input.ownerId)))
    return { versionId: input.version.id, versionNo }
  })
}

/** 이름 바꾸기(최신 버전 행의 이름도 같이 — 내려받기 이름). 남의 문서는 false */
export async function renameOwnedMemberDocument(
  ownerId: string,
  documentId: string,
  name: string,
  now: Date = new Date()
): Promise<boolean> {
  return db.transaction(async tx => {
    const res = await tx
      .update(memberDocuments)
      .set({ name, updatedAt: now, lastOpenedAt: now, deletionNotifiedAt: null })
      .where(and(eq(memberDocuments.id, documentId), eq(memberDocuments.ownerId, ownerId)))
      .returning({ latest: memberDocuments.latestVersionNo })
    if (res.length !== 1) return false
    await tx
      .update(memberDocumentVersions)
      .set({ name })
      .where(
        and(
          eq(memberDocumentVersions.documentId, documentId),
          eq(memberDocumentVersions.ownerId, ownerId),
          eq(memberDocumentVersions.versionNo, res[0].latest)
        )
      )
    return true
  })
}

/** 문서 행을 지운다(버전·임시 업로드는 CASCADE). 객체는 호출자가 **먼저** 지운다. 남의 문서는 false */
export async function deleteOwnedMemberDocumentRow(
  ownerId: string,
  documentId: string
): Promise<boolean> {
  const res = await db
    .delete(memberDocuments)
    .where(and(eq(memberDocuments.id, documentId), eq(memberDocuments.ownerId, ownerId)))
    .returning({ id: memberDocuments.id })
  return res.length === 1
}

/** 문서에 딸린 임시 업로드(새 버전으로 올리던 것)의 객체 경로 — 문서를 지울 때 함께 지운다 */
export async function listOwnedDocumentUploadPaths(
  ownerId: string,
  documentId: string
): Promise<string[]> {
  const rows = await db
    .select({ blobPath: memberDocumentUploads.blobPath })
    .from(memberDocumentUploads)
    .where(
      and(
        eq(memberDocumentUploads.ownerId, ownerId),
        eq(memberDocumentUploads.documentId, documentId)
      )
    )
  return rows.map(r => r.blobPath)
}

// ── 보존(크론 전용 — 소유자를 가리지 않는다) ──────────────────────────────────

export type RetentionNoticeRow = { id: string; ownerId: string; name: string }

/** 알릴 문서: 알린 적 없고 마지막으로 연 지 365일 이상(`retentionActionOf` 'notify'와 같은 조건) */
export async function listRetentionNotifyCandidates(
  now: Date,
  limit: number
): Promise<RetentionNoticeRow[]> {
  return db
    .select({
      id: memberDocuments.id,
      ownerId: memberDocuments.ownerId,
      name: memberDocuments.name,
    })
    .from(memberDocuments)
    .where(
      and(
        isNull(memberDocuments.deletionNotifiedAt),
        lte(memberDocuments.lastOpenedAt, new Date(now.getTime() - MEMBER_DOCUMENT_IDLE_MS))
      )
    )
    .orderBy(memberDocuments.lastOpenedAt)
    .limit(limit)
}

/** 알림 시각을 남긴다 — 조건을 WHERE 에 다시 걸어 그 사이 연 문서는 건너뛴다. 실제로 표시한 id 들 */
export async function markDeletionNotified(ids: string[], now: Date): Promise<string[]> {
  if (ids.length === 0) return []
  const res = await db
    .update(memberDocuments)
    .set({ deletionNotifiedAt: now })
    .where(
      and(
        inArray(memberDocuments.id, ids),
        isNull(memberDocuments.deletionNotifiedAt),
        lte(memberDocuments.lastOpenedAt, new Date(now.getTime() - MEMBER_DOCUMENT_IDLE_MS))
      )
    )
    .returning({ id: memberDocuments.id })
  return res.map(r => r.id)
}

export type RetentionDeleteRow = {
  id: string
  ownerId: string
  name: string
  versionIds: string[]
  blobPaths: string[]
}

function deleteCondition(now: Date) {
  return and(
    isNotNull(memberDocuments.deletionNotifiedAt),
    lte(memberDocuments.deletionNotifiedAt, new Date(now.getTime() - MEMBER_DOCUMENT_GRACE_MS)),
    lte(memberDocuments.lastOpenedAt, memberDocuments.deletionNotifiedAt)
  )
}

/** 지울 문서: 알린 지 30일 이상이고 그 뒤로 열지 않았다(`retentionActionOf` 'delete'와 같은 조건). 버전 객체 경로 포함 */
export async function listRetentionDeleteCandidates(
  now: Date,
  limit: number
): Promise<RetentionDeleteRow[]> {
  const docs = await db
    .select({
      id: memberDocuments.id,
      ownerId: memberDocuments.ownerId,
      name: memberDocuments.name,
    })
    .from(memberDocuments)
    .where(deleteCondition(now))
    .orderBy(memberDocuments.deletionNotifiedAt)
    .limit(limit)
  if (docs.length === 0) return []
  const ids = docs.map(d => d.id)
  const versions = await db
    .select({
      id: memberDocumentVersions.id,
      documentId: memberDocumentVersions.documentId,
      blobPath: memberDocumentVersions.blobPath,
    })
    .from(memberDocumentVersions)
    .where(inArray(memberDocumentVersions.documentId, ids))
  const uploads = await db
    .select({
      documentId: memberDocumentUploads.documentId,
      blobPath: memberDocumentUploads.blobPath,
    })
    .from(memberDocumentUploads)
    .where(inArray(memberDocumentUploads.documentId, ids))
  return docs.map(d => ({
    ...d,
    versionIds: versions.filter(v => v.documentId === d.id).map(v => v.id),
    blobPaths: [
      ...versions.filter(v => v.documentId === d.id).map(v => v.blobPath),
      ...uploads.filter(u => u.documentId === d.id).map(u => u.blobPath),
    ],
  }))
}

/** 조건이 아직 맞을 때만 문서 행을 지운다(그 사이 열었으면 남긴다). 지웠으면 true */
export async function deleteExpiredMemberDocument(id: string, now: Date): Promise<boolean> {
  return (await claimExpiredMemberDocument(id, now)) !== null
}

/**
 * 보존 삭제의 **첫 단계** — 조건이 아직 맞으면 문서 행을 지우고(버전·임시 업로드는 FK cascade), 그 순간 그 문서가 가리키던
 * 객체 경로·버전 id 를 돌려준다. 그 사이 열었으면(조건이 깨졌으면) null 이고 아무것도 지우지 않는다.
 *
 * 객체를 먼저 지우고 행을 나중에 조건부로 지우면, 목록을 만든 뒤 주인이 문서를 연 경우 행은 남고 파일만 사라졌다
 * (2026-11-05 리뷰). 행을 먼저 지우면 최악이 "행 없는 고아 객체"라 화면은 깨지지 않는다.
 */
export async function claimExpiredMemberDocument(
  id: string,
  now: Date
): Promise<{ versionIds: string[]; blobPaths: string[] } | null> {
  return db.transaction(async tx => {
    const versions = await tx
      .select({ id: memberDocumentVersions.id, blobPath: memberDocumentVersions.blobPath })
      .from(memberDocumentVersions)
      .where(eq(memberDocumentVersions.documentId, id))
    const uploads = await tx
      .select({ blobPath: memberDocumentUploads.blobPath })
      .from(memberDocumentUploads)
      .where(eq(memberDocumentUploads.documentId, id))
    const res = await tx
      .delete(memberDocuments)
      .where(and(eq(memberDocuments.id, id), deleteCondition(now)))
      .returning({ id: memberDocuments.id })
    if (res.length !== 1) return null
    return {
      versionIds: versions.map(v => v.id),
      blobPaths: [...versions.map(v => v.blobPath), ...uploads.map(u => u.blobPath)],
    }
  })
}

/**
 * 삭제 예고 알림을 보내지 못했을 때 알림 시각을 되돌린다 — 알리지 못한 채 30일 뒤 지우지 않게(2026-11-05 리뷰).
 * 이번 실행이 남긴 시각(`notifiedAt`)과 같은 행만 되돌린다. 다음 실행이 다시 알린다.
 */
export async function clearDeletionNotified(ids: string[], notifiedAt: Date): Promise<number> {
  if (ids.length === 0) return 0
  const res = await db
    .update(memberDocuments)
    .set({ deletionNotifiedAt: null })
    .where(
      and(inArray(memberDocuments.id, ids), eq(memberDocuments.deletionNotifiedAt, notifiedAt))
    )
    .returning({ id: memberDocuments.id })
  return res.length
}

/** 24시간이 지난 임시 업로드(객체 정리용) */
export async function listExpiredMemberDocumentUploads(
  now: Date,
  limit: number
): Promise<{ id: string; blobPath: string }[]> {
  return db
    .select({ id: memberDocumentUploads.id, blobPath: memberDocumentUploads.blobPath })
    .from(memberDocumentUploads)
    .where(lte(memberDocumentUploads.createdAt, pendingCutoff(now)))
    .orderBy(memberDocumentUploads.createdAt)
    .limit(limit)
}

/**
 * 24시간 지난 임시 업로드 행을 지우고 **실제로 지운 행의 객체 경로**를 돌려준다(행 → 객체 순서). 그 사이 승격된 업로드(승격이
 * 임시 행을 지운다)는 빠져 그 객체(= 새 버전 파일)를 건드리지 않는다(업무툴 정리 크론과 같은 이유, 2026-11-05 회귀 리뷰).
 */
export async function claimMemberDocumentUploadRows(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const res = await db
    .delete(memberDocumentUploads)
    .where(inArray(memberDocumentUploads.id, ids))
    .returning({ blobPath: memberDocumentUploads.blobPath })
  return res.map(r => r.blobPath)
}

/** 이 키들 중 아직 행(버전·임시 업로드의 blob_path)이 가리키는 것 — 고아 청소는 여기 나온 키를 절대 지우지 않는다 */
export async function findReferencedMemberDocumentPaths(paths: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200)
    const v = await db
      .select({ p: memberDocumentVersions.blobPath })
      .from(memberDocumentVersions)
      .where(inArray(memberDocumentVersions.blobPath, chunk))
    const u = await db
      .select({ p: memberDocumentUploads.blobPath })
      .from(memberDocumentUploads)
      .where(inArray(memberDocumentUploads.blobPath, chunk))
    for (const r of [...v, ...u]) out.add(r.p)
  }
  return out
}

export async function deleteMemberDocumentUploadRows(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const res = await db
    .delete(memberDocumentUploads)
    .where(inArray(memberDocumentUploads.id, ids))
    .returning({ id: memberDocumentUploads.id })
  return res.length
}
