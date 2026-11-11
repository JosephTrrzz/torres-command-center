import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { generateRuntimeModule, generatedPath } from '../functions/_shared/studio-torres-runtime.generate.mjs';
import { compileTorresArtifact, TORRES_SOURCE_COMMIT } from '../functions/_shared/studio-torres-artifact';
import { contentHash } from '../functions/_shared/studio-publisher';
import { createTorresBrowser } from './fixtures/studio-torres-dom';
import manifest from '../lib/canvas-manifest.json';

async function workerExports(entry, minify = false) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'browser',
    format: 'cjs', target: 'es2022', keepNames: true, minify, write: false });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text + '\nmodule.exports.parseInput = JSON.parse;', { module, exports: module.exports, crypto: webcrypto, TextEncoder });
  return module.exports;
}

describe('runtime serialization across Worker bundling', () => {
  it('keeps the checked-in runtime synchronized with its source', async () => {
    expect(await readFile(generatedPath, 'utf8')).toBe(await generateRuntimeModule());
  });

  it('reproduces the old toString failure under actual keepNames bundling', async () => {
    const { runTorresPatches } = await workerExports('functions/_shared/studio-torres-runtime.ts');
    const browser = createTorresBrowser('/');
    expect(() => browser.run(`(${runTorresPatches.toString()})({"releaseId":"test","operations":[]});`, false))
      .toThrow(/__name is not defined/);
  });

  it.each([false, true])('emits identical, executable portable artifacts with keepNames and minify=%s', async minify => {
    const draft = { 0: { 2: { moveX: 1, moveY: 2 },
      3: { text: 'Considered design. Personal attention' },
      $content: { 'page:2.1.3': { boxWidth: 585.4470825195312 }, 'page:2.1.2.0': { text: 'Personal attention' } } } };
    const input = { releaseId: '22222222-2222-4222-8222-222222222222', snapshotId: manifest.id,
      revision: 36, sourceCommit: TORRES_SOURCE_COMMIT, draft,
      contentHash: await contentHash({ snapshotId: manifest.id, revision: 36, draft }) };
    const worker = await workerExports('functions/_shared/studio-torres-artifact.ts', minify);
    const artifact = await worker.compileTorresArtifact(worker.parseInput(JSON.stringify(input)));
    expect(artifact).toEqual(await compileTorresArtifact(input));
    // Match the portable runner's strict single-function / single-JSON-argument grammar.
    const ast = parse(artifact.script, { ecmaVersion: 2022 });
    expect(ast.body).toHaveLength(1);
    const call = ast.body[0].expression;
    expect(call.type).toBe('CallExpression');
    expect(call.callee.type).toBe('FunctionExpression');
    expect(call.arguments).toHaveLength(1);
    expect(JSON.parse(artifact.script.slice(call.arguments[0].start, call.arguments[0].end)).releaseId).toBe(input.releaseId);
    const browser = createTorresBrowser('/');
    const lead = browser.nodes.get('home-lead');
    const text = lead.childNodes[0];
    browser.run(artifact.script, false); // No Worker helpers are provided to this separate realm.
    expect(lead.style).toEqual({});
    browser.hydrate('/contact');
    expect(lead.style).toEqual({});
    browser.hydrate('/');
    expect(lead.style.width).toBe('min(585.4470825195312px, 100%)');
    expect(lead.childNodes[0]).toBe(text);
    expect(browser.nodes.get('home-lead')).toBe(lead);
    expect(browser.document.documentElement.dataset.studioApplied).toBe(input.releaseId);
    const image = browser.nodes.get('home-lion');
    const before = image.style.translate;
    browser.sections.values().next().value.clientHeight = 400;
    browser.resize[0]();
    expect(image.style.translate).not.toBe(before);
  });
});
