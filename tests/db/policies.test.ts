// Row-level security and search tests against the real Supabase database.
//
// Requires DATABASE_URL in .env (skipped otherwise). Every test runs inside a
// transaction that is rolled back, so no test data is left behind. Requests
// are simulated the way PostgREST makes them: a role switch plus the decoded
// token claims in request.jwt.claims.
import { loadEnv } from 'vite'
import pg from 'pg'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const databaseUrl = loadEnv('test', process.cwd(), '').DATABASE_URL
const firebaseProject = 'document-vault-76520'
const alice = 'test-alice-uid'
const bob = 'test-bob-uid'

type Claims = Record<string, string>

const firebaseToken = (sub: string, extra: Claims = {}): Claims => ({
  iss: `https://securetoken.google.com/${firebaseProject}`,
  aud: firebaseProject,
  sub,
  ...extra,
})

describe.skipIf(!databaseUrl)('database policies', { timeout: 120000 }, () => {
  // Each test gets its own connection, so a test that overruns can never end
  // up running statements outside the transaction another test rolled back.
  let client: pg.Client

  const query = (sql: string, params: unknown[] = []) => client.query(sql, params)

  async function seed() {
    await query(`insert into public.profiles (id, email) values ($1, 'alice@example.test'), ($2, 'bob@example.test')`, [alice, bob])
    await query(
      `insert into public.folders (id, owner_id, name, drive_folder_id) values
        ('test-folder-a', $1, 'Inspections', 'drive-folder-a'),
        ('test-folder-b', $2, 'Budgets', 'drive-folder-b')`,
      [alice, bob],
    )
    await query(
      `insert into public.documents (id, owner_id, folder_id, name, original_name, file_kind, drive_file_id, deleted_at) values
        ('test-doc-a1', $1, 'test-folder-a', 'Annual Inspection Report 2026.pdf', 'Annual Inspection Report 2026.pdf', 'pdf', 'drive-a1', null),
        ('test-doc-a2', $1, null, 'Old inspection notes.docx', 'Old inspection notes.docx', 'word', 'drive-a2', now()),
        ('test-doc-b1', $2, 'test-folder-b', 'Annual budget.xlsx', 'Annual budget.xlsx', 'spreadsheet', 'drive-b1', null)`,
      [alice, bob],
    )
    await query(
      `insert into public.document_contents (document_id, owner_id, content) values
        ('test-doc-a1', $1, 'Section 4 covers the hydraulic pump maintenance schedule for the northern depot.'),
        ('test-doc-b1', $2, 'Hydraulic equipment budget lines for next year.')`,
      [alice, bob],
    )
    await query(`insert into public.collections (id, owner_id, name) values ('00000000-0000-4000-8000-00000000000a', $1, 'Audit pack')`, [alice])
  }

  async function inTransaction(run: () => Promise<void>) {
    const connection = new pg.Client({
      connectionString: databaseUrl!.replace(/\?sslmode=require$/, ''),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 40000,
    })
    await connection.connect()
    client = connection
    try {
      await connection.query('begin')
      await seed()
      await run()
    } finally {
      // Closing without commit discards the transaction even if rollback fails.
      await connection.query('rollback').catch(() => undefined)
      await connection.end()
    }
  }

  // Switches to the database role PostgREST would use for these claims.
  async function actAs(claims: Claims) {
    await query('reset role')
    await query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await query(claims.role === 'authenticated' ? 'set local role authenticated' : 'set local role anon')
  }

  async function expectError(sql: string, params: unknown[], code: string) {
    await query('savepoint expected_error')
    let caught: { code?: string } | null = null
    try {
      await query(sql, params)
    } catch (error) {
      caught = error as { code?: string }
    }
    await query('rollback to savepoint expected_error')
    expect(caught, `expected ${code} from: ${sql}`).not.toBeNull()
    expect(caught?.code).toBe(code)
  }

  const ids = async (sql: string) => (await query(sql)).rows.map((row) => row.id).sort()

  it('shows each user only their own rows', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice))
      expect(await ids(`select id from public.documents where id like 'test-%'`)).toEqual(['test-doc-a1', 'test-doc-a2'])
      expect(await ids(`select id from public.folders where id like 'test-%'`)).toEqual(['test-folder-a'])
      expect(await ids(`select document_id as id from public.document_contents where document_id like 'test-%'`)).toEqual(['test-doc-a1'])
      expect(await ids(`select id from public.profiles where id like 'test-%'`)).toEqual([alice])
      const audit = await query(`select distinct owner_id from public.audit_events where owner_id like 'test-%'`)
      expect(audit.rows).toEqual([{ owner_id: alice }])

      await actAs(firebaseToken(bob))
      expect(await ids(`select id from public.documents where id like 'test-%'`)).toEqual(['test-doc-b1'])
    })
  })

  it('treats tokens with the authenticated role claim the same way', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice, { role: 'authenticated' }))
      expect(await ids(`select id from public.documents where id like 'test-%'`)).toEqual(['test-doc-a1', 'test-doc-a2'])
    })
  })

  it('gives requests without a Firebase token nothing', async () => {
    await inTransaction(async () => {
      await actAs({ role: 'anon', iss: 'supabase' })
      for (const table of ['profiles', 'folders', 'documents', 'document_contents', 'collections', 'collection_documents', 'audit_events']) {
        const { rowCount } = await query(`select 1 from public.${table}`)
        expect(rowCount, table).toBe(0)
      }
      await expectError(`insert into public.profiles (id) values ('intruder')`, [], '42501')
    })
  })

  it('rejects tokens issued for a different Firebase project', async () => {
    await inTransaction(async () => {
      await actAs({ iss: 'https://securetoken.google.com/some-other-project', aud: 'some-other-project', sub: alice })
      expect((await query(`select 1 from public.documents where id like 'test-%'`)).rowCount).toBe(0)
      await actAs({ ...firebaseToken(alice), aud: 'some-other-project' })
      expect((await query(`select 1 from public.documents where id like 'test-%'`)).rowCount).toBe(0)
    })
  })

  it('stops users writing rows for someone else', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice))
      await expectError(
        `insert into public.documents (id, owner_id, name, drive_file_id) values ('test-doc-x', $1, 'x', 'drive-x')`,
        [bob],
        '42501',
      )
      await expectError(`update public.documents set owner_id = $1 where id = 'test-doc-a1'`, [bob], '42501')
      expect((await query(`update public.documents set name = 'taken' where id = 'test-doc-b1'`)).rowCount).toBe(0)
      expect((await query(`delete from public.documents where id = 'test-doc-b1'`)).rowCount).toBe(0)

      await query('reset role')
      expect((await query(`select name from public.documents where id = 'test-doc-b1'`)).rows[0].name).toBe('Annual budget.xlsx')
    })
  })

  it('fills the owner from the token and blocks cross-owner links', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice))
      const inserted = await query(
        `insert into public.documents (id, name, drive_file_id) values ('test-doc-a3', 'New.pdf', 'drive-a3') returning owner_id`,
      )
      expect(inserted.rows[0].owner_id).toBe(alice)

      await expectError(`update public.documents set folder_id = 'test-folder-b' where id = 'test-doc-a1'`, [], '23503')
      await expectError(
        `insert into public.collection_documents (collection_id, document_id) values ('00000000-0000-4000-8000-00000000000a', 'test-doc-b1')`,
        [],
        '23503',
      )
      await query(`insert into public.collection_documents (collection_id, document_id) values ('00000000-0000-4000-8000-00000000000a', 'test-doc-a1')`)
      expect((await query(`select 1 from public.collection_documents`)).rowCount).toBe(1)
    })
  })

  it('stores extracted text the way the browser sends it, for the owner only', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice))
      const upsert = `insert into public.document_contents (document_id, content, extractor_version, indexed_at)
        values ($1, $2, 1, now())
        on conflict (document_id) do update set content = excluded.content, extractor_version = excluded.extractor_version, indexed_at = excluded.indexed_at
        returning owner_id`
      expect((await query(upsert, ['test-doc-a1', 'Replaced text about a centrifugal compressor.'])).rows[0].owner_id).toBe(alice)
      const found = await ids(`select id from public.search_documents('centrifugal compressor', 10)`)
      expect(found).toEqual(['test-doc-a1'])

      // Bob's document: the insert conflicts with his row, which Alice can neither see nor change.
      await expectError(upsert, ['test-doc-b1', 'overwritten'], '42501')
      // A document that does not belong to Alice cannot be given contents at all.
      await expectError(`insert into public.document_contents (document_id, content) values ('test-doc-missing', 'x')`, [], '23503')

      await query('reset role')
      expect((await query(`select content from public.document_contents where document_id = 'test-doc-b1'`)).rows[0].content).toContain('budget lines')
    })
  })

  it('records important changes in an append-only audit log', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice))
      await query(`update public.documents set deleted_at = now() where id = 'test-doc-a1'`)
      await query(`update public.documents set is_favorite = true where id = 'test-doc-a1'`)
      const events = await query(
        `select action from public.audit_events where entity_id = 'test-doc-a1' order by id`,
      )
      expect(events.rows.map((row) => row.action)).toEqual(['insert', 'trash'])

      await expectError(`update public.audit_events set action = 'x'`, [], '42501')
      await expectError(`delete from public.audit_events`, [], '42501')
    })
  })

  it('moves documents to the root when their folder is deleted', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice))
      await query(`delete from public.folders where id = 'test-folder-a'`)
      const { rows } = await query(`select folder_id, owner_id from public.documents where id = 'test-doc-a1'`)
      expect(rows[0]).toEqual({ folder_id: null, owner_id: alice })
    })
  })

  it('searches names and content within the caller’s own documents', async () => {
    await inTransaction(async () => {
      await actAs(firebaseToken(alice))
      const search = async (text: string, includeTrashed = false) =>
        (await query(`select * from public.search_documents($1, 50, $2)`, [text, includeTrashed])).rows

      expect((await search('inspection')).map((row) => row.id)).toEqual(['test-doc-a1'])
      expect((await search('inspection', true)).map((row) => row.id).sort()).toEqual(['test-doc-a1', 'test-doc-a2'])

      const content = await search('hydraulic pump')
      expect(content.map((row) => row.id)).toEqual(['test-doc-a1'])
      expect(content[0].matched_content).toBe(true)
      expect(content[0].snippet).toContain('<<hydraulic>>')

      expect((await search('inspecton')).map((row) => row.id)).toEqual(['test-doc-a1'])
      expect((await search('Repo')).map((row) => row.id)).toEqual(['test-doc-a1'])
      expect((await search('annual')).map((row) => row.id)).toEqual(['test-doc-a1'])
      expect(await search('100%_')).toEqual([])
      expect(await search('   ')).toEqual([])
    })
  })

  it('pages ranked search results and reports files missing from Drive', async () => {
    await inTransaction(async () => {
      // Before the migration is pushed, apply it inside this rolled-back transaction.
      const applied = (await query(`select to_regprocedure('public.search_documents_page(text,integer,integer,boolean)') as fn`)).rows[0].fn
      if (!applied) await query(fs.readFileSync('supabase/migrations/20261021153836_vault_search_paging.sql', 'utf8'))

      await query(
        `insert into public.documents (id, owner_id, name, original_name, file_kind, drive_file_id, folder_path) values
          ('test-doc-a4', $1, 'Inspection checklist.pdf', 'Inspection checklist.pdf', 'pdf', 'drive-a4', 'Work / Safety'),
          ('test-doc-a5', $1, 'Inspection photos.zip', 'Inspection photos.zip', 'other', 'drive-a5', '')`,
        [alice],
      )
      await query(`update public.documents set drive_missing = true where id = 'test-doc-a5'`)
      await query(`update public.documents set tags = '{safety,q3-audit}' where id = 'test-doc-a4'`)

      await actAs(firebaseToken(alice))
      const page = async (text: string, limit: number, offset: number) =>
        (await query(`select * from public.search_documents_page($1, $2, $3)`, [text, limit, offset])).rows

      const first = await page('inspection', 2, 0)
      const second = await page('inspection', 2, 2)
      expect(first).toHaveLength(2)
      expect(Number(first[0].total_count)).toBe(3)
      const all = [...first, ...second].map((row) => row.id)
      expect(new Set(all).size).toBe(3)
      expect(all.sort()).toEqual(['test-doc-a1', 'test-doc-a4', 'test-doc-a5'])

      const rows = [...first, ...second]
      expect(rows.find((row) => row.id === 'test-doc-a5').drive_missing).toBe(true)
      expect(rows.find((row) => row.id === 'test-doc-a4').folder_path).toBe('Work / Safety')

      const content = await page('hydraulic pump', 20, 0)
      expect(content.map((row) => row.id)).toEqual(['test-doc-a1'])
      expect(content[0].snippet).toContain('<<hydraulic>>')

      // "#tag" must match a tag exactly; plain words also find tags.
      expect((await page('#q3-audit', 20, 0)).map((row) => row.id)).toEqual(['test-doc-a4'])
      expect((await page('#Q3-AUDIT inspection', 20, 0)).map((row) => row.id)).toEqual(['test-doc-a4'])
      expect(await page('#q3', 20, 0)).toEqual([])
      expect((await page('safety', 20, 0)).map((row) => row.id)).toContain('test-doc-a4')

      // Bob's documents never appear in Alice's results.
      expect((await page('budget', 20, 0)).map((row) => row.id)).toEqual([])
      expect(await page('   ', 20, 0)).toEqual([])
      expect(await page('#', 20, 0)).toEqual([])
    })
  })

  it('limits how many tags a document can have', async () => {
    await inTransaction(async () => {
      const applied = (await query(`select to_regprocedure('public.search_documents_page(text,integer,integer,boolean)') as fn`)).rows[0].fn
      if (!applied) await query(fs.readFileSync('supabase/migrations/20261021153836_vault_search_paging.sql', 'utf8'))
      const tooMany = `{${Array.from({ length: 21 }, (_, index) => `tag${index}`).join(',')}}`
      await expect(query(`update public.documents set tags = $1 where id = 'test-doc-a1'`, [tooMany])).rejects.toThrow(/documents_tags_limit/)
    })
  })
})
