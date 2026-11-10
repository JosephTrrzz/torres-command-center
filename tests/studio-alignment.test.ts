import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
const context:{StudioAlignment?:{snap:Function}}={};
runInNewContext(readFileSync('public/website-preview/alignment-guides.js','utf8'),context);
const snap=context.StudioAlignment!.snap;
const bounds={left:0,top:0,width:1000,height:600};
describe('canvas alignment geometry',()=>{
 it('snaps both axes to section center within eight screen pixels',()=>{
  const r=snap({left:397,top:246,width:200,height:100},bounds);
  expect([r.dx,r.dy]).toEqual([3,4]);expect(r.guides.map((g:{label:string})=>g.label)).toEqual(['Section center','Section center']);
 });
 it('does not pull a distant element toward an anchor',()=>{expect(snap({left:125,top:125,width:150,height:150},bounds).guides).toHaveLength(0)});
 it('uses nearby item edges without moving outside the section',()=>{
  const r=snap({left:203,top:100,width:80,height:90},bounds,[{left:200,top:350,width:80,height:90}]);
  expect(r.dx).toBe(-3);expect(r.guides[0].label).toBe('Aligned with item');
 });
 it('rejects a match that would put a large element beyond the section',()=>{
  expect(snap({left:0,top:0,width:1100,height:700},bounds).guides).toHaveLength(0);
 });
 it('loads the shared guides before every page editor',()=>{
  for(let i=0;i<11;i++){const html=readFileSync(`public/website-preview/page-${i}.html`,'utf8');expect(html.indexOf('alignment-guides.js')).toBeGreaterThan(0);expect(html.indexOf('alignment-guides.js')).toBeLessThan(html.indexOf('editor-bridge.js'))}
 });
});
