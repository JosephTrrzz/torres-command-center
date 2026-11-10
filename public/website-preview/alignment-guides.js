// Shared geometry for photos, uploaded media, text bubbles, and shapes.
(function(root){
 const anchors=(r,axis)=>axis==='x'?[r.left,r.left+r.width/2,r.left+r.width]:[r.top,r.top+r.height/2,r.top+r.height];
 function snap(rect,bounds,peers=[],threshold=8){
  const result={dx:0,dy:0,guides:[]};
  for(const axis of ['x','y']){
   const own=anchors(rect,axis),limits=anchors(bounds,axis);let best=null;
   const targets=[{rect:bounds,section:true},...peers.map(rect=>({rect,section:false}))];
   for(const target of targets)for(const [i,point] of anchors(target.rect,axis).entries())for(const value of own){
    const delta=point-value,shifted=own.map(v=>v+delta);
    if(Math.abs(delta)>threshold||shifted[0]<limits[0]-.1||shifted[2]>limits[2]+.1)continue;
    if(!best||Math.abs(delta)<Math.abs(best.delta))best={axis,point,delta,label:target.section?(i===1?'Section center':(axis==='x'?(i===0?'Left edge':'Right edge'):(i===0?'Top edge':'Bottom edge'))):'Aligned with item'};
   }
   if(best){result[axis==='x'?'dx':'dy']=best.delta;result.guides.push(best)}
  }
  return result;
 }
 root.StudioAlignment={snap};
 if(typeof document==='undefined')return;
 let session=null,layer=null;
 function clear(){layer?.remove();layer=null;session=null}
 function begin(node,section){
  clear();const bounds=section.getBoundingClientRect();
  const peers=[...section.querySelectorAll('.local-shape,img[data-editable],h1,h2,h3,p')]
   .filter(el=>el!==node&&!el.contains(node)&&!node.contains(el)&&!el.closest('#shape-toolbar,#local-image-tools')&&(!el.closest('.local-shape')||el.matches('.local-shape')))
   .slice(0,150).map(el=>el.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
  session={bounds,peers};
 }
 function move(rect,free=false){
  layer?.remove();layer=null;
  if(!session||free)return {dx:0,dy:0};
  const result=snap(rect,session.bounds,session.peers);
  if(!result.guides.length)return result;
  layer=document.createElement('div');layer.className='studio-alignment-guides';layer.setAttribute('aria-hidden','true');
  for(const g of result.guides){
   const line=document.createElement('div');line.className='studio-alignment-line';
   const vertical=g.axis==='x',b=session.bounds;
   Object.assign(line.style,vertical?{left:g.point+'px',top:Math.max(0,b.top)+'px',height:Math.max(0,Math.min(innerHeight,b.bottom)-Math.max(0,b.top))+'px',width:'1px'}:{top:g.point+'px',left:Math.max(0,b.left)+'px',width:Math.max(0,Math.min(innerWidth,b.right)-Math.max(0,b.left))+'px',height:'1px'});
   const bubble=document.createElement('span');bubble.className='studio-alignment-bubble';bubble.textContent=g.label;
   const x=vertical?g.point+10:rect.left+rect.width/2,y=vertical?rect.top-32:g.point+10;
   Object.assign(bubble.style,{left:Math.max(8,Math.min(innerWidth-160,x))+'px',top:Math.max(8,Math.min(innerHeight-36,y))+'px'});
   layer.append(line,bubble);
  }
  document.body.append(layer);return result;
 }
 Object.assign(root.StudioAlignment,{begin,move,clear});
 for(const event of ['pointerup','pointercancel','blur','resize'])addEventListener(event,clear);
 addEventListener('scroll',clear,true);
 addEventListener('keydown',e=>{if(e.key==='Escape')clear()});
 const css=document.createElement('style');css.textContent=`
 .studio-alignment-guides{--guide-gold:#a57d3d;--guide-beige:#f5efe4;position:fixed;inset:0;z-index:2147483646;pointer-events:none!important}
 .studio-alignment-line{position:fixed;background:var(--guide-gold);box-shadow:0 0 0 1px #fff7}
 .studio-alignment-bubble{position:fixed;padding:5px 10px;border:1px solid var(--guide-gold);border-radius:999px;background:var(--guide-beige);color:#493b28;font:600 12px/1.4 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px #13223816}
 `;document.head.append(css);
})(globalThis);
