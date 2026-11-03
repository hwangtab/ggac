import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 타임뱅크 게시판 쿼리(`src/db/queries/timebankBoard.ts`)를 **마이그레이션을
 * 적용한 파일 DB**로 검증한다. 장터 쿼리 테스트(`queriesMarket.test.mjs`)와 같은 모양.
 */

const DB_PATH = 'scripts/testing/.queries-timebank-board-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let client
let board
let profiles
let seq = 0

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  board = await import('../../src/db/queries/timebankBoard.ts')
  profiles = await import('../../src/db/queries/timebankProfiles.ts')
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

async function newMember(label = 'm', extra = {}) {
  seq += 1
  const id = `tbb-${label}-${seq}`
  const { upsertProfile } = await import('../../src/db/queries/profiles.ts')
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: `${label}${seq}`,
    registration_status: 'approved',
    is_active: true,
    ...extra,
  })
  return id
}

const fields = (over = {}) => ({
  kind: 'offer',
  category: 'lesson',
  title: '레슨',
  description: '설명',
  estimated_minutes: 60,
  ...over,
})

test('만들고 읽으면 snake_case 행과 글쓴이 이름이 온다', async () => {
  const author = await newMember('author')
  const { id } = await board.createTimebankListing(author, fields({ task_date: null }))
  const row = await board.getTimebankListing(id)
  assert.equal(row.id, id)
  assert.equal(row.author_id, author)
  assert.ok(row.author_name)
  assert.equal(row.kind, 'offer')
  assert.equal(row.category, 'lesson')
  assert.equal(row.estimated_minutes, 60)
  assert.equal(row.status, 'open')
  assert.equal(row.comment_count, 0)
  assert.equal(row.volunteer_count, 0)
  assert.equal(typeof row.created_at, 'string')
  const owner = await board.getTimebankListingOwner(id)
  assert.deepEqual(owner, { author_id: author, title: '레슨', kind: 'offer', status: 'open' })
})

test('목록 kind·category·status·author 필터, 본문 없음', async () => {
  const a = await newMember('fa')
  const b = await newMember('fb')
  const offer = await board.createTimebankListing(a, fields({ category: 'moving' }))
  const request = await board.createTimebankListing(b, fields({ kind: 'request' }))
  const task = await board.createTimebankListing(
    a,
    fields({ kind: 'coop_task', task_date: '2026-12-01' })
  )
  const closed = await board.createTimebankListing(b, fields({ kind: 'request' }))
  await board.closeTimebankListing(closed.id)

  const all = await board.listTimebankListings({ offset: 0, limit: 100 })
  assert.equal('description' in all.rows[0], false)

  const ids = r => r.rows.map(x => x.id)
  const requests = await board.listTimebankListings({ kind: 'request', offset: 0, limit: 100 })
  assert.ok(ids(requests).includes(request.id))
  assert.ok(!ids(requests).includes(offer.id))
  assert.ok(requests.rows.every(r => r.kind === 'request'))

  const tasks = await board.listTimebankListings({ kind: 'coop_task', offset: 0, limit: 100 })
  assert.ok(ids(tasks).includes(task.id))
  assert.ok(tasks.rows.every(r => r.kind === 'coop_task'))

  const moving = await board.listTimebankListings({ category: 'moving', offset: 0, limit: 100 })
  assert.deepEqual(ids(moving), [offer.id])

  const open = await board.listTimebankListings({
    status: 'open',
    authorId: b,
    offset: 0,
    limit: 100,
  })
  assert.deepEqual(ids(open), [request.id])

  const mine = await board.listTimebankListings({ authorId: a, offset: 0, limit: 100 })
  assert.deepEqual(ids(mine).sort(), [offer.id, task.id].sort())

  // 조합 업무 스위치가 꺼졌을 때 화면이 쓰는 excludeKinds — 다른 필터와 함께 걸린다.
  const mineNoTasks = await board.listTimebankListings({
    authorId: a,
    excludeKinds: ['coop_task'],
    offset: 0,
    limit: 100,
  })
  assert.deepEqual(ids(mineNoTasks), [offer.id])
  const allNoTasks = await board.listTimebankListings({
    excludeKinds: ['coop_task'],
    offset: 0,
    limit: 100,
  })
  assert.ok(!ids(allNoTasks).includes(task.id))
  assert.ok(ids(allNoTasks).includes(request.id))
})

test('삭제된 글은 목록·상세·소유 조회에서 빠진다', async () => {
  const a = await newMember('del')
  const { id } = await board.createTimebankListing(a, fields())
  await board.softDeleteTimebankListing(id)
  assert.equal(await board.getTimebankListing(id), null)
  assert.equal(await board.getTimebankListingOwner(id), null)
  const { rows } = await board.listTimebankListings({ authorId: a, offset: 0, limit: 100 })
  assert.equal(rows.length, 0)
})

test('페이지: limit+1로 다음 페이지 유무를 안다', async () => {
  const a = await newMember('page')
  await board.createTimebankListing(a, fields())
  await board.createTimebankListing(a, fields())
  const first = await board.listTimebankListings({ authorId: a, offset: 0, limit: 1 })
  assert.equal(first.rows.length, 1)
  assert.equal(first.hasNext, true)
  const second = await board.listTimebankListings({ authorId: a, offset: 1, limit: 1 })
  assert.equal(second.hasNext, false)
})

test('부분 수정은 준 칸만 바꾸고 상태를 바꿀 수 있다', async () => {
  const a = await newMember('upd')
  const { id } = await board.createTimebankListing(a, fields())
  await board.updateTimebankListing(id, { title: '새 제목', estimated_minutes: null })
  let row = await board.getTimebankListing(id)
  assert.equal(row.title, '새 제목')
  assert.equal(row.estimated_minutes, null)
  assert.equal(row.description, '설명')
  await board.closeTimebankListing(id)
  assert.equal((await board.getTimebankListing(id)).status, 'closed')
  await board.setTimebankListingStatus(id, 'open')
  row = await board.getTimebankListing(id)
  assert.equal(row.status, 'open')
})

test('열린 글 수: 제공·요청만, 닫힘·삭제 제외', async () => {
  const a = await newMember('count')
  await board.createTimebankListing(a, fields())
  await board.createTimebankListing(a, fields({ kind: 'request' }))
  await board.createTimebankListing(a, fields({ kind: 'coop_task' }))
  const closed = await board.createTimebankListing(a, fields())
  await board.closeTimebankListing(closed.id)
  const deleted = await board.createTimebankListing(a, fields())
  await board.softDeleteTimebankListing(deleted.id)
  assert.equal(await board.countOpenListingsByAuthor(a), 2)
})

test('댓글: 시간순, 삭제분은 본문 없이 자리만, 댓글 수는 살아 있는 것만', async () => {
  const a = await newMember('ca')
  const b = await newMember('cb')
  const { id } = await board.createTimebankListing(a, fields())
  const c1 = await board.createTimebankComment({ listingId: id, authorId: b, content: '첫 댓글' })
  // 같은 밀리초에 찍히면 순서가 id로 갈린다 — 시간순을 보려면 시각을 벌린다.
  await new Promise(resolve => setTimeout(resolve, 5))
  const c2 = await board.createTimebankComment({ listingId: id, authorId: a, content: '답' })
  await board.softDeleteTimebankComment(c1.id)

  const list = await board.listTimebankComments(id)
  assert.deepEqual(
    list.map(c => [c.id, c.content, c.is_deleted]),
    [
      [c1.id, null, true],
      [c2.id, '답', false],
    ]
  )
  assert.ok(list[1].author_name)
  assert.equal((await board.getTimebankListing(id)).comment_count, 1)
  assert.deepEqual(await board.listTimebankCommenterIds(id), [a])
  assert.deepEqual(await board.getTimebankCommentOwner(c2.id), {
    author_id: a,
    listing_id: id,
    is_deleted: false,
  })
})

test('자원: 중복은 멱등(UNIQUE), 철회 후 재자원하면 withdrawn_at이 null로 돌아온다', async () => {
  const admin = await newMember('admin')
  const v = await newMember('vol')
  const { id } = await board.createTimebankListing(admin, fields({ kind: 'coop_task' }))

  const first = await board.volunteer(id, v)
  assert.equal(first.changed, true)
  const again = await board.volunteer(id, v)
  assert.equal(again.changed, false)
  const rows = await client.execute({
    sql: 'SELECT count(*) AS n FROM timebank_task_volunteers WHERE listing_id = ? AND member_id = ?',
    args: [id, v],
  })
  assert.equal(Number(rows.rows[0].n), 1)
  assert.equal(await board.isVolunteering(id, v), true)
  assert.equal((await board.getTimebankListing(id)).volunteer_count, 1)

  const w = await board.withdrawVolunteer(id, v)
  assert.equal(w.changed, true)
  assert.equal((await board.withdrawVolunteer(id, v)).changed, false)
  const withdrawn = await client.execute({
    sql: 'SELECT withdrawn_at FROM timebank_task_volunteers WHERE listing_id = ? AND member_id = ?',
    args: [id, v],
  })
  assert.notEqual(withdrawn.rows[0].withdrawn_at, null)
  assert.equal(await board.isVolunteering(id, v), false)
  assert.deepEqual(await board.listVolunteers(id), [])

  const back = await board.volunteer(id, v)
  assert.equal(back.changed, true)
  const after = await client.execute({
    sql: 'SELECT withdrawn_at FROM timebank_task_volunteers WHERE listing_id = ? AND member_id = ?',
    args: [id, v],
  })
  assert.equal(after.rows[0].withdrawn_at, null)
  const list = await board.listVolunteers(id)
  assert.deepEqual(
    list.map(r => r.member_id),
    [v]
  )
  assert.deepEqual(Object.keys(list[0]).sort(), ['display_name', 'member_id', 'volunteered_at'])
})

test('getRejoinIdentity는 재가입 키 재료(email·phone)만 좁혀 읽는다', async () => {
  const m = await newMember('ident', { phone_number: '010-1111-2222' })
  const ident = await profiles.getRejoinIdentity(m)
  assert.deepEqual(ident, { email: `${m}@test.local`, phone: '010-1111-2222' })
  assert.equal(await profiles.getRejoinIdentity('nobody'), null)
})

async function agree(memberId, at = Date.now()) {
  await client.execute({
    sql: `INSERT INTO timebank_profiles (member_id, terms_version, agreed_at, created_at, updated_at)
          VALUES (?, '2026-11', ?, ?, ?)`,
    args: [memberId, at, at, at],
  })
}

test('listVolunteeredTasks: 철회·삭제·남의 자원은 빼고 내 조합 업무만', async () => {
  const admin = await newMember('vadm')
  const me = await newMember('vme')
  const other = await newMember('voth')
  const t1 = await board.createTimebankListing(admin, fields({ kind: 'coop_task', title: '하나' }))
  const t2 = await board.createTimebankListing(admin, fields({ kind: 'coop_task', title: '둘' }))
  const t3 = await board.createTimebankListing(admin, fields({ kind: 'coop_task', title: '셋' }))
  await board.volunteer(t1.id, me)
  await board.volunteer(t2.id, me)
  await board.withdrawVolunteer(t2.id, me)
  await board.volunteer(t3.id, me)
  await board.softDeleteTimebankListing(t3.id)
  await board.volunteer(t1.id, other)

  const rows = await board.listVolunteeredTasks(me)
  assert.deepEqual(
    rows.map(r => r.title),
    ['하나']
  )
  assert.equal(rows[0].id, t1.id)
  assert.equal(rows[0].status, 'open')
  assert.equal(typeof rows[0].volunteered_at, 'string')
})

test('requestAuthorShare: 3명 미만이면 가리고, 3명 이상이면 비율을 준다', async () => {
  const month = '2032-04'
  const inMonth = Date.parse('2032-04-10T03:00:00Z')
  const afterMonth = Date.parse('2032-05-10T03:00:00Z')
  const before = await board.requestAuthorShare(month)

  const authors = []
  for (let i = 0; i < 3; i++) {
    const id = await newMember('ra')
    await agree(id, inMonth)
    authors.push(id)
  }
  const late = await newMember('ralate')
  await agree(late, afterMonth)

  const r1 = await board.createTimebankListing(authors[0], fields({ kind: 'request' }))
  const r2 = await board.createTimebankListing(authors[1], fields({ kind: 'request' }))
  await board.createTimebankListing(authors[1], fields({ kind: 'request' }))
  await board.createTimebankListing(authors[2], fields({ kind: 'offer' }))
  const setCreated = (id, at) =>
    client.execute({
      sql: 'UPDATE timebank_listings SET created_at = ? WHERE id = ?',
      args: [at, id],
    })
  await setCreated(r1.id, inMonth)
  await setCreated(r2.id, inMonth)

  const two = await board.requestAuthorShare(month)
  assert.equal(two.participants, before.participants + 3, '그달 말 뒤에 동의한 사람은 빠진다')
  // 요청 작성자는 2명(같은 사람의 두 글은 한 명). 다른 테스트의 글쓴이는 동의
  // 프로필이 없어 세지 않는다.
  assert.equal(two.request_authors, null, '2명은 가린다')
  assert.equal(two.ratio, null)

  const r3 = await board.createTimebankListing(authors[2], fields({ kind: 'request' }))
  await setCreated(r3.id, inMonth)
  const three = await board.requestAuthorShare(month)
  assert.equal(three.request_authors, 3)
  assert.equal(three.ratio, 3 / three.participants)
})
