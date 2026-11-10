const $=s=>document.querySelector(s), frame=$('#canvas'),status=$('#status');
let pages=[],active=0,editing=true,selection=null,dirty=false;
const key='torres-actual-local-v1';let drafts={};try{if(!new URLSearchParams(location.search).has('connected'))drafts=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
function send(data){frame.contentWindow.postMessage(data,'*')}
function restore(){send({type:'restore-groups',groups:drafts[active]?.$groups||[]});send({type:'restore-locks',locks:[...(drafts[active]?.$locks||[]),...Object.keys(drafts.$sharedContent||{}).filter(k=>drafts.$sharedContent[k]?.movementLocked)]});const additions=(drafts[active]?.$addedSections||[]).map(v=>({v,type:'restore-added-sections',field:'sections'}));const copies=(drafts[active]?.$copies||[]).map(v=>({v,type:'restore-copies',field:'copies'}));for(const item of [...additions,...copies].sort((a,b)=>(a.v.index??0)-(b.v.index??0)))send({type:item.type,[item.field]:[item.v]});send({type:'restore-shapes',shapes:drafts[active]?.$shapes||[]});send({type:'restore',edits:drafts[active]||{},sections:drafts[active]?.$sections||{}})}
let saveTimer=null;
function persistDraft(){try{localStorage.setItem(key,JSON.stringify(drafts));dirty=false;status.textContent='Saved in this browser · Nothing was published.';return true}catch{dirty=true;status.textContent='Browser storage is full or unavailable. Keep this tab open; your changes are not saved.';return false}}
function changed(){dirty=true;status.textContent='Saving locally… · Your live website is unchanged.';clearTimeout(saveTimer);saveTimer=setTimeout(persistDraft,350)}
function closeInspector(clear=true){selection=null;$('#inspector').hidden=true;if(clear)send({type:'clear'})}
function loadPage(i){$('#undo-shape').disabled=true;$('#redo-shape').disabled=true;closeInspector();active=i;frame.src=pages[i].file+'?studioEpoch='+(++canvasEpoch);$('#title').textContent=pages[i].title;document.querySelectorAll('.page-toggle').forEach((b,j)=>{if(i===j)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
let canvasEpoch=0;
window.addEventListener('message',e=>{if(e.source===frame.contentWindow&&canvasEpoch&&e.data?.epoch!==canvasEpoch)e.stopImmediatePropagation()});
let canvasReady=false,pendingCapture=null,captureSerial=0;
function captureDraft(){
 if(!canvasReady)return Promise.resolve(true);
 if(pendingCapture)return pendingCapture.promise;
 const requestId=++captureSerial;
 let resolve;const promise=new Promise(r=>resolve=r);
 const timeout=setTimeout(()=>{pendingCapture=null;status.textContent='The editor is still saving. Please try again before leaving this page.';resolve(false)},3000);
 pendingCapture={requestId,promise,resolve,timeout};send({type:'capture-shared',requestId});return promise;
}
async function openPage(i){if(!pages[i])return;if(active===i&&canvasReady)return;if(!await captureDraft())return;clearTimeout(saveTimer);if(dirty&&!persistDraft())return;canvasReady=false;loadPage(i)}
window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!=='null'||e.data.page!==pages[active]?.file)return;const d=e.data;if(d.type==='context-ready')canvasReady=true;if(d.type==='shared-captured'&&pendingCapture&&d.requestId===pendingCapture.requestId){const pending=pendingCapture;pendingCapture=null;clearTimeout(pending.timeout);setTimeout(()=>pending.resolve(true),0)}});
fetch('pages.json').then(r=>r.json()).then(data=>{pages=data;data.forEach((p,i)=>{const b=document.createElement('button');b.className='page-toggle';b.textContent=p.title;b.onclick=()=>openPage(i);$('#pages').append(b)});openPage(0)});
function selectedValues(){if(!selection)return{};const page=drafts[active]??={};if(selection.kind==='section')return (page.$sections??={})[selection.id]??={};return page[selection.id]??={}}
function showControls(d){selection=d;$('#inspector').classList.toggle('header-bar',d.label==='Header');$('#inspector').hidden=!editing;$('#inspector').classList.toggle('section-bar',d.kind==='section');$('#selection-title').textContent=d.kind==='image'?'Edit photo':d.label==='Header'?'Edit header':'Edit section';$('#photo-controls').hidden=d.kind!=='image';$('#section-controls').hidden=d.kind!=='section';const v=selectedValues();
 if(d.kind==='image'){$('#alt').value=v.alt??d.alt;$('#media-frame').value=v.frame??'original';$('#media-opacity').value=v.opacity??100;$('#fit').value=v.fit??'cover';$('#position').value=v.position??'center'}
 else{$('#section-width').value=v.width??100;$('#section-width-value').textContent=v.width?v.width+'%':'Original';$('#section-height').value=v.height??'';$('#spacing').value=v.spacing??'';$('#surface').value=v.surface??'original'}
}
window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!=='null')return;const d=e.data;if(d.page!==pages[active]?.file)return;
 if(d.type==='shapes-ready')send({type:'restore-shapes',shapes:drafts[active]?.$shapes||[]});
 if(d.type==='shapes-change'&&Array.isArray(d.shapes)){(drafts[active]??={}).$shapes=d.shapes;$('#undo-shape').disabled=!d.canUndo;$('#redo-shape').disabled=!d.canRedo;changed()}
 if(d.type==='ready'){send({type:'mode',editing})}
 if(d.type==='added-sections-change'&&Array.isArray(d.sections)){(drafts[active]??={}).$addedSections=d.sections;changed()}
 if(d.type==='photo-move'&&Number.isInteger(d.id)&&Number.isFinite(d.x)&&Number.isFinite(d.y)&&Math.abs(d.x)<=100&&Math.abs(d.y)<=100){const v=(drafts[active]??={})[d.id]??={};v.moveX=d.x;v.moveY=d.y;changed()}
 if(d.type==='change'&&Number.isInteger(d.id)&&typeof d.text==='string'){const p=drafts[active]??={};p[d.id]={...p[d.id],text:d.text};changed()}
 if(d.type==='selected'&&['image','section'].includes(d.kind)&&Number.isInteger(d.id)&&editing){selection=d;if(d.kind==='section')showControls(d);else{$('#inspector').hidden=true;status.textContent='Drag the photo to move. Drag its edges to resize. Double-click to crop, or use the image toolbar.'}}
 if(d.type==='resize'&&Number.isInteger(d.id)&&Number.isFinite(d.width)&&d.width>=10&&d.width<=100&&Number.isFinite(d.height)&&d.height>=40&&d.height<=1200){const p=drafts[active]??={};p[d.id]={...p[d.id],width:d.width,height:d.height};changed()}
 if(d.type==='media-change'&&editing&&Number.isInteger(d.id)&&['cover','contain'].includes(d.fit)){const p=drafts[active]??={},v=p[d.id]??={};v.fit=d.fit;if(Number.isFinite(d.cropX)&&d.cropX>=0&&d.cropX<=100&&Number.isFinite(d.cropY)&&d.cropY>=0&&d.cropY<=100){v.cropX=d.cropX;v.cropY=d.cropY}restore();changed()}
 if(d.type==='image-action'&&editing&&Number.isInteger(d.id)){selection={kind:'image',id:d.id,alt:d.alt};if(d.action==='settings')showControls(selection);if(d.action==='flip'){const v=selectedValues();v.flipX=!v.flipX;restore();changed()}if(d.action==='reset'){const v=selectedValues();for(const k of ['width','height','fit','position','cropX','cropY','flipX','opacity','frame','moveX','moveY'])delete v[k];restore();changed()}if(d.action==='replace')$('#image').click()}
 if(d.type==='deselected'){selection=null;$('#inspector').hidden=true}
 if(d.type==='navigate'){const url=new URL(d.url);const i=pages.findIndex(p=>url.origin==='https://torrescotechnology.com'&&p.route.replace(/\/$/,'')===url.pathname.replace(/\/$/,''));if(i>=0)openPage(i);else status.textContent='This link is disabled in the local preview.'}
});
$('#save').onclick=async()=>{if(await captureDraft()){clearTimeout(saveTimer);persistDraft()}};
$('#mode').onclick=e=>{editing=!editing;e.target.textContent=editing?'Editing':'Preview';e.target.setAttribute('aria-pressed',editing);closeInspector();$('#shapes').disabled=!editing;$('#shape-picker').hidden=true;$('#shapes').setAttribute('aria-expanded','false');send({type:'mode',editing})};
for(const [id,phone]of [['desktop',false],['phone',true]])$('#'+id).onclick=()=>{frame.classList.toggle('phone',phone);$('#desktop').setAttribute('aria-pressed',!phone);$('#phone').setAttribute('aria-pressed',phone)};
$('#close').onclick=closeInspector;$('#inspector').addEventListener('keydown',e=>{if(e.key==='Escape')closeInspector()});
for(const [id,field,numeric]of [['media-frame','frame',false],['media-opacity','opacity',true],['alt','alt',false],['fit','fit',false],['position','position',false],['section-width','width',true],['section-height','height',true],['spacing','spacing',true],['surface','surface',false]]){
 $('#'+id).addEventListener('input',e=>{if(!selection)return;if(!e.target.checkValidity())return;const v=selectedValues();if(selection.kind==='section'&&['height','spacing'].includes(field))delete v.sizePreset;if(field==='position'){delete v.cropX;delete v.cropY}if(e.target.value==='')delete v[field];else v[field]=numeric?Number(e.target.value):e.target.value;if($('#'+id+'-value'))$('#'+id+'-value').textContent=e.target.value+'%';restore();changed()});
}
$('#reset-size').onclick=()=>{if(!selection)return;const v=selectedValues();for(const k of ['width','height','fit','position','cropX','cropY','flipX','opacity','frame','moveX','moveY','spacing','surface'])delete v[k];restore();showControls(selection);changed()};
$('#replace').onclick=()=>$('#image').click();
$('#image').onchange=async e=>{
 const file=e.target.files[0];if(!file||selection?.kind!=='image')return;const page=active,id=selection.id;e.target.value='';
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){status.textContent='Choose a PNG, JPEG or WebP under 2 MB.';return}
 try{const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>24000000){bitmap.close();throw Error('Choose an image under 24 megapixels.')}bitmap.close();const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});const p=drafts[page]??={};p[id]={...p[id],src};if(active===page)restore();changed();status.textContent='Photo replaced locally. Save locally to keep it.'}catch(error){status.textContent=error.message||'This image could not be opened.'}
};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});

$('#shapes').onclick=()=>{const p=$('#shape-picker');p.hidden=!p.hidden;$('#shapes').setAttribute('aria-expanded',!p.hidden)};
for(const b of document.querySelectorAll('[data-shape]'))b.onclick=()=>{if(!editing)return;send({type:'add-shape',kind:b.dataset.shape});$('#shape-picker').hidden=true;$('#shapes').setAttribute('aria-expanded','false')};
$('#undo-shape').onclick=()=>send({type:'shape-history',direction:'undo'});$('#redo-shape').onclick=()=>send({type:'shape-history',direction:'redo'});
