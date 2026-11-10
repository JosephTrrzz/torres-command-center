// Selection changes share the existing private draft and site history boundaries.
(()=>{
 // The surrounding pasteboard owns pointer capture, so the drag crosses the
 // sandboxed preview without losing its coordinates or granting DOM access.
 const stage=frame.closest('.stage');let outside=null;
 function relay(phase,e){const r=frame.getBoundingClientRect();send({type:'marquee-outside',phase,x:e.clientX-r.left,y:e.clientY-r.top,add:e.shiftKey});}
 stage?.addEventListener('pointerdown',e=>{if(!editing||e.button!==0||e.target!==stage)return;e.preventDefault();outside=e.pointerId;stage.setPointerCapture(e.pointerId);relay('start',e)});
 stage?.addEventListener('pointermove',e=>{if(outside!==e.pointerId)return;e.preventDefault();relay('move',e)});
 function endOutside(phase,e){if(outside===null)return;relay(phase,e);const pointer=outside;outside=null;if(stage.hasPointerCapture(pointer))stage.releasePointerCapture(pointer);}
 stage?.addEventListener('pointerup',e=>endOutside('end',e));
 stage?.addEventListener('pointercancel',e=>endOutside('cancel',e));
 stage?.addEventListener('lostpointercapture',e=>endOutside('cancel',e));
 addEventListener('blur',e=>endOutside('cancel',e));
 addEventListener('keydown',e=>{if(e.key==='Escape')endOutside('cancel',e)});
 addEventListener('message',e=>{
  const d=e.data;if(e.source!==frame.contentWindow||e.origin!=='null'||d?.page!==pages[active]?.file)return;
  if(d.type==='groups-change'&&editing&&Array.isArray(d.groups)&&d.groups.length<=100){
   const used=new Set();const groups=[];
   for(const group of d.groups){if(!Array.isArray(group)||group.length<2||group.length>200)continue;const valid=group.filter(k=>typeof k==='string'&&/^(page:|photo:|shape:|header:|footer:)/.test(k)&&k.length<180&&!used.has(k));if(valid.length<2)continue;for(const k of valid)used.add(k);groups.push(valid);}
   (drafts[active]??={}).$groups=groups;changed();
  }
  if(d.type==='locks-change'&&editing&&Array.isArray(d.locks)){
   const valid=d.locks.filter(k=>typeof k==='string'&&k.length<180).slice(0,500);
   (drafts[active]??={}).$locks=valid.filter(k=>! /^(header|footer):/.test(k));
   const shared=drafts.$sharedContent??={};for(const k of Object.keys(shared))if(/^(header|footer):/.test(k)&&shared[k]?.movementLocked)shared[k].movementLocked=false;
   for(const k of valid.filter(k=>/^(header|footer):/.test(k)))Object.assign(shared[k]??={},{movementLocked:true});changed();
  }
  if(d.type==='selection-moved'&&editing&&Array.isArray(d.changes)&&d.changes.length<=200){
   const page=drafts[active]??={};
   for(const c of d.changes){if(!c||typeof c!=='object')continue;
    if(c.kind==='photo'&&Number.isInteger(c.id)&&[c.x,c.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=100))Object.assign(page[c.id]??={},{moveX:c.x,moveY:c.y});
    if(c.kind==='text'&&typeof c.key==='string'&&/^(page|header|footer):/.test(c.key)&&[c.x,c.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=2400)){const content=c.key.startsWith('page:')?(page.$content??={}):(drafts.$sharedContent??={});Object.assign(content[c.key]??={},{offsetX:c.x,offsetY:c.y});}
   }
   if(Array.isArray(d.shapes)&&d.shapes.length<=100)page.$shapes=d.shapes;
   changed();
  }
 });
})();
