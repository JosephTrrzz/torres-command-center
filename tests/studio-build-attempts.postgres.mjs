// Executable PostgreSQL migration tests, entirely in memory. No Supabase/network.
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite node --test tests/studio-build-attempts.postgres.mjs
// Or install PGlite in the caller's test environment and omit PGLITE_MODULE.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const sql = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const client = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const release = '33333333-3333-4333-8333-333333333333';
const attempt = '44444444-4444-4444-8444-444444444444';
const second = '55555555-5555-4555-8555-555555555555';
const hash = 'a'.repeat(64), source = 'b'.repeat(40);
const proof = { deployment_id: 'provider-1', artifact_hash: 'c'.repeat(64), verified_at: '2026-11-10T00:00:00Z',
  routes_verified: true, runtime_verified: true, functional_verified: true };
let db;
const reserve = (patch = {}) => {
  const p = { id: attempt, release, client, hash, source, environment: 'preview', branch: 'codex/studio-publish-preview', preview: null, previous: null, ...patch };
  return db.query('select * from public.studio_reserve_build_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [p.id,p.release,p.client,p.hash,p.source,p.environment,p.branch,p.preview,p.previous]);
};
const claim = (id = attempt, tenant = client) => db.query('select * from public.studio_claim_build_attempt($1,$2)', [id, tenant]);
const advance = (expected, stage, provider = null, evidence = null, id = attempt, tenant = client) =>
  db.query('select * from public.studio_advance_build_attempt($1,$2,$3,$4,$5,$6)', [id,tenant,expected,stage,provider,evidence === null ? null : JSON.stringify(evidence)]);
async function previewSuccess() {
  await reserve(); await claim(); await advance('triggering','building','provider-1');
  await advance('building','succeeded',null,proof);
}
async function asRole(role, fn) {
  await db.exec('set role ' + role);
  try { return await fn(); } finally { await db.exec('reset role'); }
}

describe('studio_build_attempts PostgreSQL behavior', () => {
  before(async () => {
    db = new PGlite();
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.clients(id uuid primary key);');
    await db.exec(sql('studio_canvas_drafts.sql'));
    await db.exec(sql('studio_publications.sql'));
    await db.exec(sql('studio_build_attempts.sql'));
    // Replaying the additive migration must preserve the constraints and grants.
    await db.exec(sql('studio_build_attempts.sql'));
    await db.exec(sql('studio_preview_cancellation.sql'));
    await db.exec(sql('studio_preview_cancellation.sql'));
  });
  beforeEach(async () => {
    await db.exec('truncate public.clients cascade;');
    await db.query('insert into clients values ($1),($2)', [client, foreign]);
    await db.query("insert into studio_sites(client_id,name,enabled,publishing_enabled,canvas_snapshot_id) values ($1,'One',true,true,$3),($2,'Two',true,true,$3)", [client,foreign,hash]);
    await db.query('insert into studio_canvas_drafts(client_id,snapshot_id,revision,draft,actor_id) values ($1,$2,1,\'{}\',$1)', [client,hash]);
    await db.query('insert into studio_publications(id,client_id,snapshot_id,revision,actor_id,request_key,content_hash) values ($1,$2,$3,1,$2,$1,$3)', [release,client,hash]);
  });
  after(async () => { await db?.close(); });

  it('enables RLS, denies browser reads/mutations/RPCs and service direct writes', async () => {
    const rls = await db.query("select relrowsecurity from pg_class where oid='public.studio_build_attempts'::regclass");
    assert.equal(rls.rows[0].relrowsecurity, true);
    for (const role of ['anon','authenticated']) {
      await assert.rejects(asRole(role, () => db.query('select * from studio_build_attempts')), /permission denied/);
      await assert.rejects(asRole(role, () => reserve()), /permission denied/);
      await assert.rejects(asRole(role, () => claim()), /permission denied/);
      await assert.rejects(asRole(role, () => advance('reserved','failed')), /permission denied/);
    }
    await asRole('service_role', () => reserve());
    await asRole('service_role', () => db.query('select * from studio_build_attempts'));
    for (const statement of ['delete from studio_build_attempts', "update studio_build_attempts set stage='failed'", 'insert into studio_build_attempts(id) values (gen_random_uuid())']) {
      await assert.rejects(asRole('service_role', () => db.exec(statement)), /permission denied/);
    }
    assert.equal((await asRole('service_role', () => claim())).rows.length, 1);
  });
  it('reserves idempotently but rejects identity reuse and parent client/hash mismatch', async () => {
    const first = (await reserve()).rows[0];
    assert.equal((await reserve()).rows[0].created_at.getTime(), first.created_at.getTime());
    await assert.rejects(reserve({ source: 'c'.repeat(40) }), /identity already used/);
    await assert.rejects(reserve({ id: second, client: foreign }), /does not match/);
    await assert.rejects(reserve({ id: second, hash: 'd'.repeat(64) }), /does not match/);
  });
  it('returns exactly one dispatch claim and fences foreign clients/stale transitions', async () => {
    await reserve();
    assert.equal((await claim(attempt,foreign)).rows.length, 0);
    const claims = await Promise.all([claim(), claim()]);
    assert.equal(claims.reduce((n,r) => n+r.rows.length,0),1);
    const won = claims.find(r => r.rows.length).rows[0];
    assert.equal(won.stage,'triggering'); assert.ok(won.triggered_at);
    assert.equal((await advance('reserved','failed')).rows.length,0);
    assert.equal((await advance('triggering','building','provider-1',null,attempt,foreign)).rows.length,0);
  });
  it('keeps ambiguous attempts active and never grants another create claim', async () => {
    await reserve(); await claim(); await advance('triggering','ambiguous');
    assert.equal((await claim()).rows.length,0);
    await assert.rejects(reserve({ id: second }), /studio_one_active_build_attempt/);
    await assert.rejects(advance('ambiguous','failed'), /check constraint/);
    await assert.rejects(advance('ambiguous','triggering'), /claim function/);
    await advance('ambiguous','building','provider-1');
    await advance('building','failed');
    assert.equal((await reserve({ id: second })).rows[0].stage,'reserved');
  });
  it('requires a provider identity before a dispatched attempt can fail', async () => {
    await reserve(); await claim();
    await assert.rejects(advance('triggering','failed'), /check constraint/);
    await advance('triggering','failed','confirmed-failed-provider');
  });
  it('blocks reservation/claim when enrollment or the parent publication is inactive', async () => {
    await db.query('update studio_sites set publishing_enabled=false where client_id=$1',[client]);
    await assert.rejects(reserve(), /disabled/);
    await db.query('update studio_sites set publishing_enabled=true where client_id=$1',[client]);
    await reserve();
    await db.query("update studio_publications set status='failed' where id=$1",[release]);
    assert.equal((await claim()).rows.length,0);
  });
  it('enforces immutable identity, provider ID, timestamps and terminal attempts', async () => {
    await reserve(); await claim(); await advance('triggering','building','provider-1');
    for (const assignment of ["source_commit='"+'d'.repeat(40)+"'", "branch='other'", "triggered_at=now()+interval '1 hour'", "provider_deployment_id='provider-2'", "content_hash='"+'d'.repeat(64)+"'", "previous_production_deployment_id='previous'"]) {
      await assert.rejects(db.exec('update studio_build_attempts set '+assignment), /immutable/);
    }
    await assert.rejects(advance('building','failed','provider-2'), /immutable/);
    await advance('building','failed');
    await assert.rejects(advance('failed','ambiguous'), /immutable/);
  });
  it('requires browser proof, rejects null flags and refuses unknown evidence keys', async () => {
    await reserve(); await claim(); await advance('triggering','building','provider-1');
    await assert.rejects(advance('building','succeeded'), /check constraint/);
    for (const field of Object.keys(proof)) {
      await assert.rejects(advance('building','succeeded',null,{ ...proof, [field]: null }), /Invalid preview/);
    }
    await assert.rejects(advance('building','succeeded',null,{ ...proof, env_vars: { secret:'no' } }), /Invalid preview/);
    await assert.rejects(advance('building','succeeded',null,{ ...proof, deployment_id:'other' }), /Invalid preview/);
    await advance('building','succeeded',null,proof);
  });
  it('copies immutable successful preview evidence into production and retains rollback identity', async () => {
    const production = { id: second, environment:'production',branch:'main',preview:attempt,previous:'previous-production' };
    await assert.rejects(reserve(production), /verified preview|check constraint/);
    await previewSuccess();
    await assert.rejects(reserve({ ...production, source:'d'.repeat(40) }), /exact release and source/);
    const row = (await reserve(production)).rows[0];
    assert.deepEqual(row.preview_evidence,proof);
    assert.equal(row.previous_production_deployment_id,'previous-production');
    await assert.rejects(db.query("update studio_build_attempts set preview_evidence='{}' where id=$1",[second]), /immutable/);
    await claim(second); await advance('triggering','building','production-1',null,second);
    await advance('building','succeeded',null,null,second);
  });
  it('requires production rollback identity and rejects mismatched branches', async () => {
    await previewSuccess();
    await assert.rejects(reserve({ id: second,environment:'production',branch:'main',preview:attempt }), /check constraint/);
    await assert.rejects(reserve({ id: second,branch:'unapproved' }), /check constraint/);
  });
  const cancel = (patch={}) => {
    const p={id:attempt,client,release,hash,source,expected:'ambiguous',reason:'Operator revoked preview after uncertain create; provider outcome unknown.',...patch};
    return db.query('select * from public.studio_cancel_preview_attempt($1,$2,$3,$4,$5,$6,$7)',
      [p.id,p.client,p.release,p.hash,p.source,p.expected,p.reason]);
  };
  it('atomically cancels unknown preview without inventing provider evidence; fences late writes',async()=>{
    await reserve();await claim();await advance('triggering','ambiguous');
    const before=(await db.query('select * from studio_build_attempts')).rows[0];
    const cancelled=(await cancel()).rows[0];
    assert.equal(cancelled.stage,'cancelled');assert.equal(cancelled.provider_deployment_id,null);
    assert.equal(cancelled.preview_evidence,null);assert.ok(cancelled.cancelled_at);assert.ok(cancelled.cancellation_actor);
    for(const key of ['id','client_id','release_id','content_hash','source_commit','branch','environment'])assert.equal(cancelled[key],before[key]);
    assert.equal(cancelled.triggered_at.getTime(),before.triggered_at.getTime());
    assert.equal((await db.query('select status from studio_publications')).rows[0].status,'failed');
    assert.equal((await advance('ambiguous','building','late-provider')).rows.length,0);
    await assert.rejects(advance('cancelled','building','late-provider'),/immutable/);
    await assert.rejects(db.exec("update studio_build_attempts set cancellation_reason='rewritten'"),/immutable/);
    assert.equal((await claim()).rows.length,0);
    await assert.rejects(reserve({id:second}),/active publication/);
    // A NEW saved checkpoint/release can proceed; old attempt/parent stay terminal.
    await db.query("insert into studio_canvas_drafts(client_id,snapshot_id,revision,draft,actor_id) values ($1,$2,2,'{}',$1)",[client,hash]);
    await db.query('insert into studio_publications(id,client_id,snapshot_id,revision,actor_id,request_key,content_hash) values ($1,$2,$3,2,$2,$1,$3)',[second,client,hash]);
    assert.equal((await reserve({id:second,release:second})).rows[0].stage,'reserved');
  });
  it('denies cancellation to browser and service roles including the generic advance RPC',async()=>{
    await reserve();await claim();await advance('triggering','ambiguous');
    for(const role of ['anon','authenticated','service_role'])await assert.rejects(asRole(role,()=>cancel()),/permission denied/);
    await assert.rejects(asRole('service_role',()=>advance('ambiguous','cancelled')),/claim function/);
    assert.equal((await db.query('select status from studio_publications')).rows[0].status,'queued');
  });
  it('rejects stale and foreign cancellation identities without changing the parent',async()=>{
    await reserve();await claim();await advance('triggering','ambiguous');
    for(const patch of [{client:foreign},{release:second},{hash:'d'.repeat(64)},{source:'c'.repeat(40)},{expected:'triggering'},{reason:''}])await assert.rejects(cancel(patch));
    assert.equal((await db.query('select stage from studio_build_attempts')).rows[0].stage,'ambiguous');
    assert.equal((await db.query('select status from studio_publications')).rows[0].status,'queued');
  });
  it('cancels reserved and known building previews while retaining any provider ID',async()=>{
    await reserve();const reserved=(await cancel({expected:'reserved'})).rows[0];
    assert.equal(reserved.triggered_at,null);assert.equal(reserved.stage,'cancelled');
  });
  it('retains the known provider when revoking a building preview',async()=>{
    await reserve();await claim();await advance('triggering','building','known-provider');
    assert.equal((await cancel({expected:'building'})).rows[0].provider_deployment_id,'known-provider');
  });
  it('never cancels a production attempt or a release that already reserved production',async()=>{
    await previewSuccess();await reserve({id:second,environment:'production',branch:'main',preview:attempt,previous:'baseline'});
    await claim(second);await advance('triggering','ambiguous',null,null,second);
    await assert.rejects(cancel({id:second}),/preview identity/);
    await assert.rejects(cancel({expected:'succeeded'}),/active preview stage/);
    assert.equal((await db.query('select status from studio_publications')).rows[0].status,'queued');
    await assert.rejects(advance('ambiguous','failed',null,null,second),/check constraint/);
  });

});
