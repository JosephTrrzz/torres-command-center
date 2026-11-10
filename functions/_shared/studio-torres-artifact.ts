import manifest from '../../lib/canvas-manifest.json';
import routes from '../../public/website-preview/pages.json';
import { canonical, contentHash, UUID } from './studio-publisher';
import { publicationDraftIssue } from './studio-publication-draft';

// First source adapter: the two edits present in saved revision 26. Unsupported
// changes fail the whole compilation; they must never be silently omitted.
// This module produces an artifact, not a provider receipt or a readiness flag.
export const TORRES_SOURCE_COMMIT = '3733811fd7ddab2cd25a4a62585c9b5d860076a3';
export type ArtifactInput = {
  releaseId: string; snapshotId: string; revision: number; contentHash: string;
  sourceCommit: string; draft: unknown;
};
type RecordValue = Record<string, unknown>;
function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(path + ': expected an object.');
  return value as RecordValue;
}
function empty(value: unknown, path: string) {
  if (Object.keys(record(value, path)).length) throw Error(path + ': this edit does not yet have a verified public-site mapping.');
}
function number(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(path + ': invalid measurement.');
  return value;
}

export async function compileTorresArtifact(input: ArtifactInput) {
  const issue = publicationDraftIssue(input.draft, input.snapshotId);
  if (issue) throw Error(issue);
  if (!UUID.test(input.releaseId) || input.snapshotId !== manifest.id ||
    input.sourceCommit !== TORRES_SOURCE_COMMIT || !Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw Error('The saved draft and approved website source do not match.');
  }
  if (await contentHash({ snapshotId: input.snapshotId, revision: input.revision, draft: input.draft }) !== input.contentHash) {
    throw Error('The saved draft fingerprint does not match this release.');
  }
  const draft = record(input.draft, 'draft');
  let photo: { x: number; y: number } | null = null;
  const text: { width?: number; height?: number } = {};
  for (const [page, value] of Object.entries(draft)) {
    if (page === '$shared') {
      for (const [key, attributes] of Object.entries(record(value, page))) {
        if (!/^(header|footer):(?:\d+(?:\.\d+)*)?$/.test(key)) throw Error('Invalid shared-content identity.');
        const attrs = record(attributes, page + '.' + key);
        // Null style captures are editor bookkeeping. The approved source has no
        // inline styles at these shared locations; actual shared edits need mapping.
        if (Object.keys(attrs).length !== 1 || attrs.style !== null) throw Error('Shared header/footer changes need a verified source mapping.');
      }
    } else if (page === '$sharedContent') {
      empty(value, page);
    } else if (page !== '0') {
      if (!/^(?:[1-9]|10)$/.test(page)) throw Error('Unknown website page.');
      empty(value, 'page ' + page);
    } else {
      for (const [key, patch] of Object.entries(record(value, 'Home'))) {
        if (key === '2') {
          const p = record(patch, 'Home hero image');
          if (Object.keys(p).some(k => !['moveX', 'moveY'].includes(k))) throw Error('This hero-image edit needs an additional source mapping.');
          if (Object.keys(p).length) photo = {
            x: number(p.moveX, -100, 100, 'Hero image horizontal position'),
            y: number(p.moveY, -100, 100, 'Hero image vertical position'),
          };
        } else if (key === '$content') {
          for (const [id, values] of Object.entries(record(patch, key))) {
            const p = record(values, id);
            if (id !== 'page:2.1.3' || Object.keys(p).some(k => !['boxWidth', 'boxHeight'].includes(k))) {
              throw Error(id + ': this content edit needs an additional source mapping.');
            }
            if ('boxWidth' in p) text.width = number(p.boxWidth, 40, 2400, 'Introduction width');
            if ('boxHeight' in p) text.height = number(p.boxHeight, 24, 2400, 'Introduction height');
          }
        } else if (key === '$sections') {
          for (const [id, p] of Object.entries(record(patch, key))) {
            if (!/^\d+$/.test(id)) throw Error('Invalid section identity.');
            empty(p, 'Home section ' + id);
          }
        } else {
          throw Error('Home.' + key + ': this edit needs an additional source mapping.');
        }
      }
    }
  }
  const settings = canonical({ photo, text });
  // Fixed selectors and code. Only validated finite numbers reach this script.
  // Do not replace DOM nodes: public form, navigation and receptionist listeners
  // remain attached. ResizeObserver preserves the editor's section-relative units.
  const script = `(()=>{'use strict';const p=${settings};function apply(){const main=document.querySelector('main#home.homePage');if(!main)return;const section=main.querySelector('section.hero.homeFullBleed'),image=section?.querySelector('.heroLionBrand img'),lead=section?.querySelector('p.heroLead');if(!section||!image||!lead)return;if(p.text.width!==undefined){lead.style.width=p.text.width+'px';lead.style.maxWidth='100%';lead.style.boxSizing='border-box';lead.style.overflowWrap='anywhere';lead.style.whiteSpace='normal';lead.style.flexShrink='0'}if(p.text.height!==undefined){lead.style.minHeight=p.text.height+'px';lead.style.height='auto'}if(p.photo){const move=()=>{image.style.translate=(p.photo.x*section.clientWidth/100)+'px '+(p.photo.y*section.clientHeight/100)+'px';if(getComputedStyle(image).position==='static')image.style.position='relative';image.style.zIndex='21';for(let n=image.parentElement;n&&n!==section;n=n.parentElement)n.style.overflow='visible'};move();if(typeof ResizeObserver==='function')new ResizeObserver(move).observe(section);else addEventListener('resize',move,{passive:true})}document.documentElement.dataset.studioApplied=${JSON.stringify(input.releaseId)}}if(document.readyState==='complete')apply();else addEventListener('load',apply,{once:true})})();`;
  const artifactHash = await contentHash({ script, sourceCommit: input.sourceCommit, contentHash: input.contentHash });
  return {
    protocol: 1 as const,
    releaseId: input.releaseId,
    contentHash: input.contentHash,
    sourceCommit: input.sourceCommit,
    assetPath: '/_studio/' + artifactHash + '.js',
    script,
    marker: '<meta name="torres-studio-release" content="' + input.releaseId + ':' + input.contentHash + '">',
    routes: routes.map(page => page.route),
  };
}
