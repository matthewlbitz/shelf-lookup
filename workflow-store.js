const { range } = require('./ordered-search');
function installWorkflow(app, db, catalog) {
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_stacks (
    id TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, stage TEXT NOT NULL,
    owner TEXT, worker TEXT, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS workflow_operations (id TEXT PRIMARY KEY, stack_id TEXT NOT NULL);`);
  const read = id => db.prepare('SELECT * FROM workflow_stacks WHERE id=?').get(id);
  const view = row => row && ({...row, data:JSON.parse(row.data)});
  const fail = message => { throw new Error(message); };
  const idOK = id => typeof id === 'string' && /^[\w-]{16,80}$/.test(id);
  const insert = (id,parent,name,stage,data) => db.prepare('INSERT INTO workflow_stacks(id,parent,name,stage,data) VALUES(?,?,?,?,?)').run(id,parent,name,stage,JSON.stringify(data));
  app.get('/api/workflow', (_req,res) => res.json(db.prepare('SELECT * FROM workflow_stacks ORDER BY updated_at DESC, id').all().map(view)));
  app.get('/api/workflow/:id', (req,res) => {const row=read(req.params.id);return row?res.json(view(row)):res.status(404).json({error:'Stack not found.'});});
  app.post('/api/workflow', (req,res) => {
    try {
      const {id,name,entry,upc,rangeMode}=req.body;
      if (!idOK(id) || !['prepare','assign','columns','shelves'].includes(entry)) fail('Choose a starting point.');
      const old=read(id);if(old)return res.json(view(old));
      insert(id,null,String(name||'New stack').slice(0,80),entry==='prepare'?'prepare':'capture',
        {entry:entry==='prepare'?'assign':entry,upc:!!upc,rangeMode:entry==='prepare'||entry==='assign'?!!rangeMode:false,items:[],position:0,confirmed:[],buckets:{},skipped:[]});
      res.json(view(read(id)));
    }catch(error){res.status(400).json({error:error.message});}
  });
  app.post('/api/workflow/:id', (req,res) => {
    try {
      const result=db.transaction(()=>{
        const row=read(req.params.id);if(!row)fail('Stack not found.');
        const {operation,owner,worker,revision,action}=req.body;
        if(!idOK(operation)||!idOK(owner))fail('Browser identity is missing.');
        const previous=db.prepare('SELECT stack_id FROM workflow_operations WHERE id=?').get(operation);
        if(previous){if(previous.stack_id!==row.id)fail('Operation belongs to another stack.');return view(row);}
        if(row.revision!==revision)fail('This stack changed. Reload it before continuing.');
        if(action!=='claim' && action!=='takeover' && row.owner!==owner)fail('Open this stack for work first.');
        if(action==='claim' && row.owner && row.owner!==owner)fail(`This stack is being worked on by ${row.worker||'another person'}.`);
        const d=JSON.parse(row.data);let stage=row.stage, nextOwner=row.owner,nextWorker=row.worker;
        if(action==='claim'||action==='takeover'){nextOwner=owner;nextWorker=String(worker||'Operator').slice(0,60);}
        else if(action==='release'){nextOwner=null;nextWorker=null;}
        else if(action==='prepared'){if(stage!=='prepare')fail('Preparation is already finished.');stage='capture';}
        else if(action==='internal'){
          const code=String(req.body.barcode||'');
          if(stage!=='capture'||!d.upc||d.pendingBarcode)fail('Finish the current barcode pair first.');
          if(!/^\d{1,30}$/.test(code)||d.items.some(i=>i.barcode===code))fail('Use a numeric KTRU barcode that is not already scanned.');
          if(catalog.lookup(code))fail('This KTRU barcode is already assigned.');
          d.pendingBarcode=code;
        }
        else if(action==='external'){
          if(stage!=='capture'||!d.pendingBarcode)fail('Scan the KTRU barcode first.');
          const upc=req.body.upc===null?null:String(req.body.upc||'').replace(/[\s-]/g,'');
          if(upc!==null&&!/^(\d{8}|\d{12,14})$/.test(upc))fail('Scan a UPC/EAN or choose Skip UPC.');
          d.items.push({barcode:d.pendingBarcode,upc,album:null});d.pendingBarcode=null;
        }
        else if(action==='capture'){
          if(stage!=='capture')fail('Scanning is finished.');
          let codes=req.body.codes;
          if(req.body.first!==undefined){
            if(!d.rangeMode||d.upc)fail('This stack uses individual scans.');
            const first=String(req.body.first),last=String(req.body.last);
            if(!/^\d{1,30}$/.test(first)||!/^\d{1,30}$/.test(last)|| (BigInt(first)-BigInt(last))**2n>100000000n)fail('Use numeric endpoints with at most 10,000 steps.');
            codes=range(first,last);if(d.items.length)fail('Clear the existing range first.');
          }
          if(!Array.isArray(codes)||!codes.length||codes.length+d.items.length>10001)fail('Invalid barcode list.');
          for(const code of codes){
            if(typeof code!=='string'||!/^\d{1,30}$/.test(code)||d.items.some(i=>i.barcode===code))fail('Use a numeric KTRU barcode that is not already in this stack.');
            const album=catalog.lookup(code);
            if(d.entry==='assign' && album)fail(`Barcode ${code} is already assigned. Start it at column or shelf sorting.`);
            if(d.entry!=='assign' && !album)fail(`Barcode ${code} is not assigned. Start it at assignment.`);
            const upc=req.body.upc===null?null:String(req.body.upc||'').replace(/[\s-]/g,'');
            if(d.upc && upc!==null && !/^(\d{8}|\d{12,14})$/.test(upc))fail('Scan a UPC/EAN or choose Skip UPC.');
            d.items.push({barcode:code,upc:d.upc?upc:null,album:album||null});
          }
        }
        else if(action==='remove'){if(stage!=='capture')fail('Use Set aside during confirmation.');if(d.pendingBarcode)d.pendingBarcode=null;else d.items.pop();}
        else if(action==='clear'){if(stage!=='capture')fail('Only unprocessed scans can be cleared.');d.items=[];d.pendingBarcode=null;}
        else if(action==='finish'){
          if(stage!=='capture'||!d.items.length||d.pendingBarcode)fail('Scan this stack first.');
          d.queue=(d.rangeMode&&!d.upc?d.items:d.items.slice().reverse());d.position=0;
          stage=d.entry==='assign'?'confirm':d.entry;
        }
        else if(action==='assign'||action==='skip'){
          if(stage!=='confirm')fail('This stack is not being assigned.');
          const item=d.queue[d.position];if(!item)fail('No album remaining.');
          if(action==='assign')d.confirmed.push({...item,album:catalog.assign(item.barcode,Number(req.body.albumId))});
          else d.skipped.push(item);
          d.position++;
          if(d.position===d.queue.length){d.queue=d.confirmed.slice().reverse();d.position=0;stage=d.queue.length?'columns':'complete';}
        }
        else if(action==='place'){
          if(!['columns','shelves'].includes(stage))fail('This stack is not being sorted.');
          const item=d.queue[d.position];if(!item)fail('No album remaining.');
          const column=String(item.album?.new_shelf||'').trim().match(/^(\d+)\s*[a-z]+$/i)?.[1];
          if(stage==='columns'&&column)(d.buckets[column]||=[]).push(item);
          else if(!column)d.skipped.push(item);
          d.position++;
          if(d.position===d.queue.length){
            if(stage==='columns')for(const [column,items] of Object.entries(d.buckets)){
              insert(`${row.id}-${column}`,row.id,`${row.name} · Column ${column}`,'shelves',
                {entry:'shelves',items,queue:items.slice().reverse(),position:0,skipped:[],column});
            }
            stage='complete';nextOwner=null;nextWorker=null;
          }
        }
        else fail('Unknown action.');
        db.prepare('UPDATE workflow_stacks SET data=?,stage=?,owner=?,worker=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(JSON.stringify(d),stage,nextOwner,nextWorker,row.id);
        db.prepare('INSERT INTO workflow_operations(id,stack_id) VALUES(?,?)').run(operation,row.id);
        return view(read(row.id));
      })();res.json(result);
    }catch(error){res.status(409).json({error:error.message});}
  });
}
module.exports={installWorkflow};
