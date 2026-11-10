import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
const read=(name:string)=>readFileSync(`public/website-preview/${name}`,'utf8');
describe('production sandbox preview',()=>{
 it.each(['page-0.html','page-0','page-10'])('preserves manifest page identity after hosting redirects: %s',file=>{
  const source=read('editor-bridge.js');
  const sendLine=source.split('\n').find(line=>line.startsWith('const send='))!;
  let message:unknown;
  runInNewContext(`${sendLine};send({type:'ready'})`,{documentEpoch:2,location:{pathname:`/website-preview/${file}`},parent:{postMessage:(data:unknown)=>{message=data}}});
  expect(message).toEqual({type:'ready',epoch:2,page:file.replace(/\.html$/,'')+'.html'});
 });
 it('loads editor styling from its deployed asset directory',()=>{
  expect(read('editor-interactions.js')).toContain("style.href='/website-preview/editor-chrome.css");
 });
 it('permits only public snapshot resources across the opaque sandbox boundary',()=>{
  const headers=readFileSync('public/_headers','utf8');
  expect(headers.split('/login/')[0]).toContain('Cross-Origin-Resource-Policy: same-origin');
  for(const route of ['/website-preview/assets/*','/website-preview/*.js','/website-preview/*.css'])expect(headers.split(route+'\n')[1].split('\n\n')[0]).toContain('Cross-Origin-Resource-Policy: cross-origin');
  expect(read('index.html')).toContain('sandbox="allow-scripts"');
  expect(read('index.html')).not.toContain('allow-same-origin');
 });
});
