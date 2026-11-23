import { PGlite } from "@electric-sql/pglite"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

// Real PostgreSQL constraints/functions with synthetic data. Supabase's auth and
// cron services are stubbed; pgcrypto is unnecessary for these built-in hashes.
let db: PGlite
let org: string
let project: string
let otherOrg: string
let otherProject: string
const session = "11111111-1111-4111-8111-111111111111"
const key = "22222222-2222-4222-8222-222222222222"
const second = "33333333-3333-4333-8333-333333333333"

async function scalar<T>(sql: string, args: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ value: T }>(sql, args)
  return rows[0].value
}
async function insertSession(id = session, sessionKey = key, target = project, organisation = org, status = "completed") {
  await db.query(`INSERT INTO sessions(id, session_id, organisation_id, project_id, status, applicant_email, created_at)
    VALUES($1,$2,$3,$4,$5,'synthetic@example.test',now() - interval '100 days')`, [id, sessionKey, organisation, target, status])
}
async function erase(id = session, target = project, organisation = org) {
  return scalar<{ receiptId: string; alreadyErased: boolean }>(
    "SELECT erase_project_session($1,$2,$3) AS value", [organisation, target, id])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS 'SELECT sha256(convert_to($1, ''UTF8''))';
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE SCHEMA cron; CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
    CREATE PUBLICATION supabase_realtime;`)
  const directory = path.resolve("supabase/migrations")
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = (await readFile(path.join(directory, file), "utf8"))
      .replace(/CREATE EXTENSION IF NOT EXISTS (pgcrypto|pg_cron);/gi, "")
    try { await db.exec(sql) } catch (error) {
      throw new Error(`Migration ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  org = await scalar("SELECT id AS value FROM organisations WHERE slug='dev'")
  project = await scalar("SELECT id AS value FROM projects WHERE organisation_id=$1 LIMIT 1", [org])
  otherOrg = await scalar("SELECT id AS value FROM organisations WHERE slug='fixture_b'")
  otherProject = await scalar("SELECT id AS value FROM projects WHERE organisation_id=$1 LIMIT 1", [otherOrg])
}, 30_000)

beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE sessions, profiles, project_retention_policies,
    private.session_erasure_receipts, application_invitations, entry_flag_dismissals CASCADE;`)
})
afterAll(async () => { await db?.close() })

describe("transactional session privacy in PostgreSQL", () => {
  it("cascades personal records, invitations, correction history, jobs and snapshots, and returns a repeatable receipt", async () => {
    await insertSession()
    await insertSession(second, "other-client-key", otherProject, otherOrg)
    const message = await scalar<string>(`INSERT INTO messages(session_id,organisation_id,project_id,role,content)
      VALUES($1,$2,$3,'user','Synthetic conversation') RETURNING id AS value`, [session, org, project])
    await db.query(`INSERT INTO session_completion_jobs(organisation_id,project_id,session_id) VALUES($1,$2,$3);
    `, [org, project, session])
    const decision = await scalar<string>(`INSERT INTO application_decisions(organisation_id,project_id,session_id,decision,
      reviewer_kind,reviewer_email,access_secret) VALUES($1,$2,$3,'approved','platform','operator@example.test',gen_random_uuid()) RETURNING id AS value`, [org, project, session])
    await db.query(`SELECT correct_application_decision($1,$2,'declined','Synthetic correction',NULL,'platform',NULL,'operator@example.test',NULL,NULL,NULL)`, [session, decision])
    const webhook = await scalar<string>(`INSERT INTO webhooks(organisation_id,project_id,url,signing_secret)
      VALUES($1,$2,'https://recipient.example.test/events','synthetic') RETURNING id AS value`, [org, project])
    const verdict = await scalar<string>(`INSERT INTO verdicts(organisation_id,project_id,session_id,outcome,session_status,payload)
      VALUES($1,$2,$3,'REJECT','completed','{"synthetic":"personal data copy"}') RETURNING id AS value`, [org, project, session])
    await db.query(`INSERT INTO webhook_deliveries(webhook_id,verdict_id) VALUES($1,$2)`, [webhook, verdict])
    await db.query(`INSERT INTO webhook_deliveries(webhook_id,decision_id,event) VALUES($1,$2,'application.decided')`, [webhook, decision])
    await db.query(`INSERT INTO application_outcomes(organisation_id,project_id,session_id,decision_id,outcome)
      VALUES($1,$2,$3,$4,'removed')`, [org, project, session, decision])
    const round = await scalar<string>(`INSERT INTO allocation_rounds(organisation_id,project_id,name) VALUES($1,$2,'Synthetic') RETURNING id AS value`, [org, project])
    const cohort = await scalar<string>(`INSERT INTO cohorts(organisation_id,project_id,round_id,name) VALUES($1,$2,$3,'Synthetic') RETURNING id AS value`, [org, project, round])
    const run = await scalar<string>(`INSERT INTO allocation_runs(organisation_id,project_id,round_id,kind,actor_kind)
      VALUES($1,$2,$3,'select','platform') RETURNING id AS value`, [org, project, round])
    await db.query(`INSERT INTO cohort_members(round_id,session_id,cohort_id,run_id) VALUES($1,$2,$3,$4)`, [round, session, cohort, run])
    await db.query(`INSERT INTO cohort_moves(run_id,round_id,session_id,to_cohort_id) VALUES($1,$2,$3,$4)`, [run, round, session, cohort])
    await db.query(`INSERT INTO session_llm_usage(session_id,project_id,provider,operation,model,input_tokens,output_tokens,
      cache_creation_input_tokens,cache_creation_5m_input_tokens,cache_creation_1h_input_tokens,cache_read_input_tokens)
      VALUES($1,$2,'anthropic','synthetic','test',1,1,0,0,0,0)`, [session, project])
    await db.query(`INSERT INTO cultural_signal_events(organisation_id,project_id,session_id,source_message_id,
      signal_type,normalized_key,display_label,confidence) VALUES($1,$2,$3,$4,'scene_or_genre','jazz','Jazz',0.9)`, [org, project, session, message])
    await db.query(`INSERT INTO cultural_signal_snapshots(organisation_id,project_id,version,window_days,minimum_sessions,sensitive_minimum_sessions)
      VALUES($1,$2,1,90,5,10)`, [org, project])
    await db.query(`INSERT INTO application_invitations(organisation_id,project_id,email,audience,token_hash,session_key,expires_at)
      VALUES($1,$2,'synthetic@example.test','community',repeat('a',64),$3,now()+interval '1 day')`, [org, project, key])
    await db.query("SELECT capture_session_access_profile($1,$2,'synthetic@example.test')", [project, session])
    const receipt = await erase()
    expect(receipt.alreadyErased).toBe(false)
    for (const table of ["messages", "session_completion_jobs", "application_decisions", "cultural_signal_events", "cultural_signal_snapshots", "application_invitations", "profile_eligibility", "verdicts", "webhook_deliveries", "application_outcomes", "cohort_members", "cohort_moves", "session_llm_usage"]) {
      expect(await scalar<number>(`SELECT count(*)::int AS value FROM ${table}`)).toBe(0)
    }
    expect(await scalar("SELECT count(*)::int AS value FROM sessions WHERE id=$1", [second])).toBe(1)
    // Same email in another tenant protects the shared legacy profile.
    expect(await scalar("SELECT count(*)::int AS value FROM profiles")).toBe(1)
    expect(await erase()).toEqual({ ...receipt, alreadyErased: true })
    await expect(erase(second)).rejects.toMatchObject({ code: "GR404" })
    await erase(second, otherProject, otherOrg)
    expect(await scalar("SELECT count(*)::int AS value FROM profiles")).toBe(0)
  })

  it("blocks replayed session keys, internal IDs, late jobs and late access capture without affecting another tenant", async () => {
    await insertSession()
    await erase()
    await expect(insertSession()).rejects.toMatchObject({ code: "GR410" })
    await expect(insertSession(second)).rejects.toMatchObject({ code: "GR410" })
    await expect(insertSession(session, "new-key")).rejects.toMatchObject({ code: "GR410" })
    await expect(db.query(`INSERT INTO session_completion_jobs(organisation_id,project_id,session_id) VALUES($1,$2,$3)`, [org, project, session])).rejects.toMatchObject({ code: "23503" })
    await expect(db.query("SELECT capture_session_access_profile($1,$2,'synthetic@example.test')", [project, session])).rejects.toMatchObject({ code: "GR410" })
    expect(await scalar("SELECT count(*)::int AS value FROM profiles")).toBe(0)
    await insertSession(second, key, otherProject, otherOrg)
  })

  it("does nothing without an enabled policy and expires by message activity rather than admin updates", async () => {
    await insertSession()
    expect(await scalar("SELECT process_session_retention() AS value")).toBe(0)
    await db.query(`INSERT INTO project_retention_policies(project_id,enabled,active_days,abandoned_days,completed_days) VALUES($1,false,30,30,90)`, [project])
    expect(await scalar("SELECT process_session_retention() AS value")).toBe(0)
    expect(await scalar("SELECT count(*)::int AS value FROM session_retention_candidates($1,100,true)", [project])).toBe(1)
    await db.query("UPDATE project_retention_policies SET enabled=true WHERE project_id=$1", [project])
    await db.query("UPDATE sessions SET profile='{}' WHERE id=$1", [session])
    expect(await scalar("SELECT count(*)::int AS value FROM session_retention_candidates($1)", [project])).toBe(1)
    await db.query(`INSERT INTO messages(session_id,organisation_id,project_id,role,content) VALUES($1,$2,$3,'user','Recent activity')`, [session, org, project])
    expect(await scalar("SELECT process_session_retention() AS value")).toBe(0)
    await db.query("UPDATE messages SET sent_at=now()-interval '91 days' WHERE session_id=$1", [session])
    expect(await scalar("SELECT process_session_retention() AS value")).toBe(1)
    expect(await scalar("SELECT reason_code AS value FROM private.session_erasure_receipts")).toBe("retention")
  })

  it("respects scoped expiring holds for explicit deletion and retention, and supports release", async () => {
    await insertSession()
    await db.query(`INSERT INTO project_retention_policies(project_id,enabled,active_days,abandoned_days,completed_days) VALUES($1,true,30,30,90)`, [project])
    await expect(db.query("SELECT set_session_privacy_hold($1,$2,$3,'legal_claim',now()+interval '1 day')", [otherOrg, otherProject, session])).rejects.toMatchObject({ code: "GR404" })
    await db.query("SELECT set_session_privacy_hold($1,$2,$3,'legal_claim',now()+interval '1 day')", [org, project, session])
    await expect(erase()).rejects.toMatchObject({ code: "GR423" })
    expect(await scalar("SELECT process_session_retention() AS value")).toBe(0)
    expect(await scalar("SELECT count(*)::int AS value FROM private.session_erasure_receipts")).toBe(0)
    await db.query("SELECT set_session_privacy_hold($1,$2,$3,NULL,NULL)", [org, project, session])
    expect(await scalar("SELECT process_session_retention() AS value")).toBe(1)
  })

  it("executes deletion as service_role and denies browser roles all lifecycle RPCs and tables", async () => {
    await insertSession()
    await db.exec("SET ROLE service_role")
    await db.query("SELECT capture_session_access_profile($1,$2,'synthetic@example.test')", [project, session])
    await erase()
    await db.exec("RESET ROLE")
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`)
      await expect(erase()).rejects.toMatchObject({ code: "42501" })
      await expect(db.query("SELECT * FROM project_retention_policies")).rejects.toMatchObject({ code: "42501" })
      await expect(db.query("SELECT * FROM profiles")).rejects.toMatchObject({ code: "42501" })
      await expect(db.query("SELECT * FROM profile_eligibility")).rejects.toMatchObject({ code: "42501" })
      await expect(db.query("SELECT * FROM private.session_erasure_receipts")).rejects.toMatchObject({ code: "42501" })
      await expect(db.query("SELECT process_session_retention()")).rejects.toMatchObject({ code: "42501" })
      await db.exec("RESET ROLE")
    }
  })

  it("rolls back the receipt and all deletions if any deletion step fails", async () => {
    await insertSession()
    await db.exec(`CREATE FUNCTION public.test_block_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic deletion failure'; END; $$;
      CREATE TRIGGER test_block_erasure AFTER DELETE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.test_block_erasure();`)
    try {
      await expect(erase()).rejects.toThrow("Synthetic deletion failure")
      expect(await scalar("SELECT count(*)::int AS value FROM sessions")).toBe(1)
      expect(await scalar("SELECT count(*)::int AS value FROM private.session_erasure_receipts")).toBe(0)
      expect(await scalar("SELECT count(*)::int AS value FROM entry_identifiers")).toBe(1)
    } finally {
      await db.exec("DROP TRIGGER test_block_erasure ON sessions; DROP FUNCTION test_block_erasure();")
    }
  })

  it("keeps duplicate-review notes while another matching entry needs them, then removes orphaned notes", async () => {
    await insertSession()
    await insertSession(second, "second-key")
    await db.query(`INSERT INTO entry_flag_dismissals(project_id,kind,value,reason)
      VALUES($1,'email','synthetic@example.test','Synthetic note')`, [project])
    await erase()
    expect(await scalar("SELECT count(*)::int AS value FROM entry_flag_dismissals")).toBe(1)
    await erase(second)
    expect(await scalar("SELECT count(*)::int AS value FROM entry_flag_dismissals")).toBe(0)
  })

  it.each([['active', 1], ['abandoned', 1], ['completed', 0]])("uses the configured %s retention class", async (status, count) => {
    await insertSession(session, key, project, org, status as string)
    await db.query("UPDATE sessions SET created_at=now()-interval '15 days' WHERE id=$1", [session])
    await db.query(`INSERT INTO project_retention_policies(project_id,enabled,active_days,abandoned_days,completed_days)
      VALUES($1,true,5,10,20)`, [project])
    expect(await scalar("SELECT process_session_retention() AS value")).toBe(count)
  })
})
