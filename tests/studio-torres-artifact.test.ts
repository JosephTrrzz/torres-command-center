import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
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
    { 0: { $content: { 'page:2.1.3': { text: 'Must not silently disappear' } } } },
    { 0: { $copies: [{ html: '<script>attack()</script>' }] } },
    { 8: { 1: { text: 'Another page' } } },
    { 11: {} },
    { $shared: { 'header:': { style: 'background:url(https://tracking.invalid)' } } },
    { $sharedContent: { 'footer:': { text: 'Changed footer' } } },
  ])('refuses unsupported or unsafe edits as a whole: %j', async value => {
    await expect(compileTorresArtifact(await input(value))).rejects.toThrow();
  });
  it('applies geometry after load, recalculates on resize, and keeps existing nodes/listeners', async () => {
    const artifact = await compileTorresArtifact(await input());
    const handlers: Record<string, () => void> = {};
    const parent = { style: {}, parentElement: null as unknown };
    const image = { style: {} as Record<string,string>, parentElement: parent };
    const lead = { style: {} as Record<string,string>, unchangedListener: () => 'retained' };
    const section = { clientWidth: 1000, clientHeight: 800, querySelector: (s: string) => s === '.heroLionBrand img' ? image : lead };
    parent.parentElement = section;
    const main = { querySelector: () => section };
    const document = { readyState: 'loading', querySelector: () => main, documentElement: { dataset: {} } };
    let resize = () => {};
    runInNewContext(artifact.script, { document, getComputedStyle: () => ({position:"absolute"}), addEventListener: (event: string, callback: () => void) => { handlers[event] = callback; },
      ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} } });
    expect(lead.style).toEqual({});
    handlers.load();
    expect(lead.style.width).toBe('585.4470825195312px');
    expect(lead.style.minHeight).toBe('33.324668884277344px');
    expect(lead.unchangedListener()).toBe('retained');
    expect(image.style.position).toBeUndefined();
    expect(document.documentElement.dataset).toEqual({ studioApplied: releaseId });
    const before = image.style.translate;
    section.clientHeight = 400; resize();
    expect(image.style.translate).not.toBe(before);
    expect(Object.keys(handlers)).toEqual(['load']);
  });
});
