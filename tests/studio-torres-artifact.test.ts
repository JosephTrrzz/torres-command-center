import { describe, expect, it } from 'vitest';
import { createTorresBrowser } from './fixtures/studio-torres-dom';
import { compileTorresArtifact, TORRES_SOURCE_COMMIT } from '../functions/_shared/studio-torres-artifact';
import { contentHash } from '../functions/_shared/studio-publisher';
import manifest from '../lib/canvas-manifest.json';

const releaseId = '22222222-2222-4222-8222-222222222222';
const draft = { 0: {
  2: { moveX: 0.0002577932091776258, moveY: 0.7486839508623404 },
  $content: { 'page:2.1.3': { boxWidth: 585.4470825195312, boxHeight: 33.324668884277344 } },
  $sections: { 0: {}, 2: {} },
}, $shared: { 'header:': { style: null }, 'footer:': { style: null } } };
async function input(value: unknown = draft) {
  return { releaseId, snapshotId: manifest.id, revision: 26,
    contentHash: await contentHash({ snapshotId: manifest.id, revision: 26, draft: value }),
    sourceCommit: TORRES_SOURCE_COMMIT, draft: value };
}
describe('source-pinned Torres artifact compiler', () => {
  it('compiles the actual saved revision geometry without embedding private drafts', async () => {
    const artifact = await compileTorresArtifact(await input());
    expect(artifact.routes).toHaveLength(11);
    expect(artifact.assetPath).toMatch(/^\/_studio\/[a-f0-9]{64}\.js$/);
    expect(artifact.script).not.toContain('$shared');
    expect(artifact.script).not.toMatch(/innerHTML|fetch\(|postMessage|eval\(/);
    expect(artifact.marker).toContain(releaseId);
  });
  it('keeps generated assets deterministic and content addressed', async () => {
    expect(await compileTorresArtifact(await input())).toEqual(await compileTorresArtifact(await input()));
    const changed = structuredClone(draft); changed[0].$content['page:2.1.3'].boxWidth = 600;
    expect((await compileTorresArtifact(await input(changed))).assetPath).not.toBe((await compileTorresArtifact(await input())).assetPath);
  });
  it.each(['sourceCommit', 'snapshotId', 'contentHash', 'releaseId'])('rejects a mismatched %s before rendering', async field => {
    await expect(compileTorresArtifact({ ...await input(), [field]: 'untrusted' })).rejects.toThrow();
  });
  it.each([
    { 0: { 2: { moveX: 0, moveY: 101 } } },
    { 0: { 2: { moveX: 0, moveY: '</script>' } } },
    { 0: { $content: { 'page:2.1.3': { boxWidth: 0 } } } },
    { 0: { $content: { 'page:2.1.999': { text: 'Must not silently disappear' } } } },
    { 0: { $copies: [{ html: '<script>attack()</script>' }] } },
    { 8: { 1: { text: 'Another page' } } },
    { 11: {} },
    { $shared: { 'header:': { style: 'background:url(https://tracking.invalid)' } } },
    { $sharedContent: { 'footer:': { text: 'Changed footer' } } },
  ])('refuses unsupported or unsafe edits as a whole: %j', async value => {
    await expect(compileTorresArtifact(await input(value))).rejects.toThrow();
  });
  it('waits for the trusted route effect, recalculates on resize, and keeps existing nodes/listeners', async () => {
    const artifact = await compileTorresArtifact(await input());
    const browser = createTorresBrowser('/');
    const lead = browser.nodes.get('home-lead')!;
    const image = browser.nodes.get('home-lion')!;
    const textNode = lead.childNodes[0];
    const listener = () => 'retained';
    Object.assign(lead, { unchangedListener: listener });
    // Even a complete document and load event cannot authorize mutation.
    browser.document.readyState='complete';
    const { runInNewContext } = await import('node:vm');
    runInNewContext(artifact.script, browser.context);
    expect(lead.style).toEqual({});
    browser.handlers.load?.();
    expect(lead.style).toEqual({});
    browser.handlers['torres-studio:hydrated']();
    expect(lead.style).toEqual({});
    browser.hydrate('/contact');
    expect(lead.style).toEqual({});
    browser.hydrate('/');
    expect(lead.style.width).toBe('min(585.4470825195312px, 100%)');
    expect(lead.style.minHeight).toBe('33.324668884277344px');
    expect(browser.nodes.get('home-lead')).toBe(lead);
    expect(lead.childNodes[0]).toBe(textNode);
    expect((lead as unknown as { unchangedListener: () => string }).unchangedListener).toBe(listener);
    expect(listener()).toBe('retained');
    expect(image.style.position).toBeUndefined();
    expect(browser.document.documentElement.dataset).toEqual({ studioApplied: releaseId,torresStudioHydratedRoute:'/' });
    const before = image.style.translate;
    browser.sections.values().next().value!.clientHeight = 400;
    browser.resize[0]();
    expect(image.style.translate).not.toBe(before);
    expect(Object.keys(browser.handlers)).toEqual(['torres-studio:hydrated']);
  });
  it('accepts exact readiness already set before the script and ignores duplicate effects',async()=>{
    const b=createTorresBrowser('/');b.hydrate();b.run((await compileTorresArtifact(await input())).script,false);
    expect(b.nodes.get('home-lead')!.style.width).toBe('min(585.4470825195312px, 100%)');
    const count=b.resize.length;b.hydrate();expect(b.resize).toHaveLength(count);
  });
  it('rejects a stale route signal, clears no-op status, and reapplies to fresh nodes on return',async()=>{
    const b=createTorresBrowser('/');b.run((await compileTorresArtifact(await input())).script);
    const old=b.nodes.get('home-lion')!,before=old.style.translate;
    b.context.location.pathname='/contact';b.sections.values().next().value!.clientHeight=400;b.resize[0]();
    expect(old.style.translate).toBe(before); // Observer cannot mutate during navigation.
    b.hydrate('/contact');expect(b.document.documentElement.dataset.studioApplied).toBeUndefined();
    const fresh=createTorresBrowser('/');b.selectors.clear();for(const[k,v]of Array.from(fresh.selectors))b.selectors.set(k,v);
    b.context.location.pathname='/';b.handlers['torres-studio:hydrated']();
    expect(fresh.nodes.get('home-lead')!.style).toEqual({});
    b.hydrate('/');expect(fresh.nodes.get('home-lead')!.style.width).toBe('min(585.4470825195312px, 100%)');
    expect(b.document.documentElement.dataset.studioApplied).toBe(releaseId);
  });
});
