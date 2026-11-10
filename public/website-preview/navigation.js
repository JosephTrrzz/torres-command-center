// Navigation changes never reset the selected page, canvas edits or library data.
(()=>{
 const workspace=document.querySelector('.workspace'),title=document.querySelector('#panel-title');
 const tools=[['pages-tab','Pages','pages-panel'],['shapes','Elements','shape-picker'],['text-tab','Text','text-panel'],['uploads-tab','Uploads','uploads-panel']];
 let current='uploads-tab';
 function show(id,collapse=false){current=id;workspace.classList.toggle('panel-collapsed',collapse);for(const [key,label,panel]of tools){const button=document.querySelector('#'+key);button.setAttribute('aria-pressed',key===id&&!collapse);button.setAttribute('aria-expanded',key===id&&!collapse);document.querySelector('#'+panel).hidden=key!==id;if(key===id)title.textContent=label}document.querySelector('#pages').hidden=false;document.querySelector('#pages-heading').hidden=false}
 for(const [id]of tools)document.querySelector('#'+id).onclick=()=>show(id,current===id&&!workspace.classList.contains('panel-collapsed'));
 document.querySelector('#panel-close').onclick=()=>{show(current,true);document.querySelector('#'+current).focus()};
 document.querySelector('#editor-panel').addEventListener('keydown',e=>{if(e.key==='Escape'){show(current,true);document.querySelector('#'+current).focus()}});
 for(const button of document.querySelectorAll('[data-shape]'))button.addEventListener('click',()=>{show('shapes',matchMedia('(max-width:700px)').matches)});
 document.querySelector('#media-grid').addEventListener('click',e=>{if(e.target.closest('button')&&matchMedia('(max-width:700px)').matches)show(current,true)});
 document.querySelector('#mode').addEventListener('click',()=>{if(!editing)show(current,true);else show(current,false)});
 for(const button of document.querySelectorAll('[data-text]'))button.onclick=()=>{if(!editing)return;document.querySelector('#canvas').contentWindow.postMessage({type:'add-shape',kind:button.dataset.text==='bubble'?'bubble':'text',preset:button.dataset.text},'*');show('text-tab',matchMedia('(max-width:700px)').matches)};
 show(current,matchMedia('(max-width:700px)').matches);
})();
