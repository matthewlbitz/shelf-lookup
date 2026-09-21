(() => {
  const el=id=>document.getElementById(id);
  const uid=()=>globalThis.crypto?.randomUUID?.() || 'stack-'+Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');
  let owner,active=null,busy=false,pending=null,version=0;
  try { owner=localStorage.getItem('workflow-owner')||uid();localStorage.setItem('workflow-owner',owner);pending=JSON.parse(localStorage.getItem('workflow-pending')||'null');el('worker').value=localStorage.getItem('workflow-worker')||''; }
  catch(_){el('status').textContent='Browser storage must be available to safely save and retry work.';el('create').disabled=true;return;}
  const labels={prepare:'Prepare labels',capture:'Scan the stack',confirm:'Confirm albums',columns:'Sort into columns',shelves:'Sort onto shelves',complete:'Complete'};
  const say=text=>{el('status').textContent=text;};
  function button(text,fn,secondary=false){const b=document.createElement('button');b.textContent=text;if(secondary)b.className='secondary';b.onclick=fn;return b;}
  function text(tag,value,parent=el('workBody')){const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
  function field(label,id,parent=el('workBody')){const wrap=document.createElement('div');wrap.className='field';const l=document.createElement('label');l.htmlFor=id;l.textContent=label;const input=document.createElement('input');input.id=id;input.autocomplete='off';wrap.append(l,input);parent.append(wrap);return input;}
  async function request(url,body){let response;try{response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});}catch(_){throw Error('Server unavailable. Keep the pile in place; reconnect and retry.');}const data=await response.json();if(!response.ok){const e=Error(data.error||'Could not save.');e.rejected=true;throw e;}return data;}
  function lock(value){busy=value;document.querySelectorAll('button').forEach(b=>b.disabled=value);}
  async function persist(job){
    if(busy)return;
    if(pending && job!==pending){say('Retry the pending save before doing another step.');return;}
    pending=job;try{localStorage.setItem('workflow-pending',JSON.stringify(job));}catch(_){pending=null;say('Browser storage is full. No change sent.');return;}
    lock(true);
    try{active=await request(job.url,job.body);localStorage.removeItem('workflow-pending');pending=null;say('Saved on the library server.');render();}
    catch(e){say(e.message);if(e.rejected){pending=null;localStorage.removeItem('workflow-pending');if(active)try{active=await request('/api/workflow/'+active.id);render();}catch(_){} }}
    finally{lock(false);el('retry').hidden=!pending;}
  }
  const action=(name,extra={})=>{if(!active||busy)return;return persist({url:'/api/workflow/'+active.id,body:{operation:uid(),owner,worker:el('worker').value||'Operator',revision:active.revision,action:name,...extra}});};
  async function home(){if(busy||pending){say('Finish saving the current step first.');return;}active=null;version++;el('home').hidden=false;el('work').hidden=true;await refresh();}
  async function refresh(){try{const stacks=await request('/api/workflow');el('stackList').replaceChildren();el('completedList').replaceChildren();if(!stacks.some(s=>s.stage!=='complete'))text('p','No stacks waiting. Start one above.',el('stackList'));for(const s of stacks){const card=document.createElement('div');card.className='stack-card';text('h3',s.name+' · '+s.id.slice(-6),card);text('p',`${labels[s.stage]} · ${s.data.queue?Math.max(0,s.data.queue.length-s.data.position):s.data.items.length+(s.data.pendingBarcode?1:0)} CDs${s.owner?' · '+s.worker:' · Ready for someone to pick up'}`,card);card.append(button(s.stage==='complete'?'View':'Open stack',async()=>{if(pending||busy)return;try{active=await request('/api/workflow/'+s.id);render();}catch(e){say(e.message);}},true));(s.stage==='complete'?el('completedList'):el('stackList')).append(card);}say('Stacks loaded from the library server.');}catch(e){say(e.message);}}
  function render(){
    if(!active)return;const token=++version,d=active.data,body=el('workBody');body.replaceChildren();el('home').hidden=true;el('work').hidden=false;el('stackHeading').textContent=active.name+' · '+active.id.slice(-6);el('stage').textContent=labels[active.stage];el('release').hidden=active.owner!==owner||active.stage==='complete';el('instruction').textContent='';
    if(active.stage==='complete'){text('p',d.buckets&&Object.keys(d.buckets).length?'Column sorting is finished. Each column pile is saved on the home screen, ready for shelf sorting.':'This stack is finished.');if(d.skipped?.length)text('p',`${d.skipped.length} CDs were set aside. Keep those separate and start them again when ready.`);body.append(button('See stacks',home));return;}
    if(active.owner!==owner){text('p',active.owner?`${active.worker} has this stack. Only take over after checking that they have stopped working on it.`:'Pick up the matching physical pile and open it for work.');body.append(button(active.owner?'Take over this stack':'Work on this stack',()=>{if(!active.owner||confirm('Take over this pile? Make sure its previous operator has stopped.'))action(active.owner?'takeover':'claim');}));return;}
    if(active.stage==='prepare'){el('instruction').textContent='First separate CDs with UPC/EAN barcodes from those without. Keep them as two piles, and create one saved stack for each.';text('p',`This is the ${d.upc?'UPC/EAN':'no-UPC'} pile. Apply KTRU labels ${d.rangeMode?'in consecutive order from top to bottom':'to each CD'}. Keep the stack in order.`);text('p','Write this stack’s label on a slip and keep it with the pile.');body.append(button('Labels ready — begin scanning',()=>action('prepared')));return;}
    if(active.stage==='capture'){
      el('instruction').textContent=d.rangeMode&&!d.upc?'Keep the stack in place. Scan its first and last KTRU labels. Assignment will start at the first CD.':'Scan the top CD, then place it onto the scanned pile. Repeat down the stack. The next pass starts at the top of the new pile.';
      text('p',`${d.items.length} CDs saved`);
      if(d.rangeMode&&!d.upc){if(!d.items.length){const first=field('First KTRU barcode','first'),last=field('Last KTRU barcode','last');first.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();last.focus();}};const save=()=>action('capture',{first:first.value.trim(),last:last.value.trim()});last.onkeydown=e=>{if(e.key==='Enter'&&!e.repeat){e.preventDefault();save();}};body.append(button('Save range',save));first.focus();}}
      else if(d.upc){
        if(!d.pendingBarcode){const internal=field('KTRU barcode','internal');const save=()=>action('internal',{barcode:internal.value.trim()});internal.onkeydown=e=>{if(e.key==='Enter'&&!e.repeat){e.preventDefault();save();}};body.append(button('Save KTRU barcode',save));internal.focus();}
        else {text('p','KTRU '+d.pendingBarcode+' saved. Keep this CD in hand.');const upc=field('Same CD’s UPC / EAN','upc');const save=()=>action('external',{upc:upc.value.trim()});upc.onkeydown=e=>{if(e.key==='Enter'&&!e.repeat){e.preventDefault();save();}};body.append(button('Save UPC / EAN',save),button('Skip UPC — save KTRU only',()=>action('external',{upc:null}),true),button('Remove this KTRU scan',()=>action('remove'),true));upc.focus();}
      }
      else {const internal=field('KTRU barcode','internal');const save=()=>action('capture',{codes:[internal.value.trim()],upc:null});internal.onkeydown=e=>{if(e.key==='Enter'&&!e.repeat){e.preventDefault();save();}};body.append(button('Save this CD',save));internal.focus();}
      if(d.items.length&&!d.pendingBarcode){const controls=document.createElement('div');controls.className='assign-actions';controls.append(button('Finish scanning — '+(d.entry==='assign'?'confirm albums':'start sorting'),()=>action('finish')),button('Remove last scan',()=>action('remove'),true),button('Clear scans',()=>{if(confirm('Clear the unprocessed scans for this stack?'))action('clear');},true));body.append(controls);text('p','Last saved: '+d.items.at(-1).barcode);}return;
    }
    const item=d.queue[d.position];text('p',`CD ${d.position+1} of ${d.queue.length} · KTRU ${item.barcode}`);
    if(active.stage==='confirm'){
      el('instruction').textContent='Take the top CD. Confirm its catalog record, then place it on top of the confirmed pile. Keep CDs you set aside separate.';
      const lookupStatus=text('p',item.upc?'Checking the scanned UPC/EAN…':'Search the local catalog by artist or title.');
      const search=field('Search artist or title','search');const results=document.createElement('div');body.append(results);let searchToken=0;
      const show=albums=>{results.replaceChildren();for(const album of albums.filter(a=>!a.barcode)){const row=document.createElement('div');row.className='stack-card';text('p',`${album.artist} — ${album.title}`,row);row.append(button('Confirm this album',()=>action('assign',{albumId:album.id})));results.append(row);}};
      let timer;search.oninput=()=>{const seq=++searchToken;clearTimeout(timer);timer=setTimeout(async()=>{try{const albums=await request('/search?q='+encodeURIComponent(search.value)+'&unassigned=1');if(version===token&&seq===searchToken)show(albums);}catch(e){if(version===token)say(e.message);}},200);};
      if(item.upc)request('/external-lookup/'+encodeURIComponent(item.upc)).then(result=>{if(version!==token)return;lookupStatus.textContent='Check the album against the CD before confirming.';if(!search.value)show(result.albums?.length?result.albums:result.suggestions||[]);}).catch(()=>{if(version===token)lookupStatus.textContent='UPC lookup unavailable. The barcode is saved; search the local catalog or leave this stack for later.';});
      body.append(button('Not in catalog — set aside',()=>action('skip'),true));search.focus();return;
    }
    el('instruction').textContent=active.stage==='columns'?'Take the top CD and place it on top of the indicated column pile. Keep each column pile separate.':'Take the top CD and place it on the indicated shelf.';
    const shelf=String(item.album?.new_shelf||'').trim(),column=shelf.match(/^(\d+)\s*[a-z]+$/i)?.[1];
    text('p',`${item.album?.artist||''} — ${item.album?.title||''}`);const dest=text('div',column?(active.stage==='columns'?'Column '+column:'Shelf '+shelf):'Set aside — no shelf assigned');dest.className='destination';
    const placed=button(column?'Placed — next CD':'Set aside — next CD',()=>action('place'));body.append(placed);placed.focus();
    if(active.stage==='columns')text('p','When this stack is finished, each column pile appears on the home screen, ready for shelf sorting by you or a partner.');
  }
  el('entry').onchange=()=>{el('assignmentOptions').hidden=!['prepare','assign'].includes(el('entry').value);};
  el('create').onclick=()=>{if(pending||busy)return;localStorage.setItem('workflow-worker',el('worker').value);persist({url:'/api/workflow',body:{id:uid(),name:el('stackName').value.trim()||'Stack '+new Date().toLocaleTimeString(),entry:el('entry').value,upc:el('captureMode').value==='upc'&&!el('assignmentOptions').hidden,rangeMode:el('captureMode').value==='range'}});};
  el('homeButton').onclick=home;el('refresh').onclick=refresh;el('release').onclick=async()=>{await action('release');if(!pending)home();};el('retry').onclick=()=>persist(pending);
  if(pending){el('retry').hidden=false;say('A step needs to be saved. Retry before moving any more CDs.');}else refresh();
})();
