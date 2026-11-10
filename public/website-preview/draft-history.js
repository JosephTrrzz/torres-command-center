/* Bounded, immutable site history. Storage remains owned by the editor. */
(function(root){
 function createDraftHistory(initial,{limit=30,maxBytes=24000000}={}){
  let present=JSON.stringify(initial),past=[],future=[];
  function trim(){while(past.length+future.length>limit||past.concat(future).reduce((n,e)=>n+e.value.length*2,0)>maxBytes){if(past.length)past.shift();else if(future.length)future.shift();else break;}}
  return {
   record(value,page){const next=JSON.stringify(value);if(next===present)return false;past.push({value:present,page});present=next;future=[];trim();return true;},
   move(direction){const from=direction==='undo'?past:future,to=direction==='undo'?future:past;if(!from.length)return null;const entry=from.pop();to.push({value:present,page:entry.page});present=entry.value;trim();return {draft:JSON.parse(present),page:entry.page};},
   get canUndo(){return past.length>0},get canRedo(){return future.length>0}
  };
 }
 if(typeof module==='object')module.exports={createDraftHistory};else root.createDraftHistory=createDraftHistory;
})(typeof window==='object'?window:globalThis);
