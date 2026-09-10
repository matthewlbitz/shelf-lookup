const test = require('node:test');
const assert = require('node:assert/strict');
const {advance, suggestAlbums, barcodeStep, range} = require('../ordered-search');

test('inclusive queues assign the entire stack in physical order in either direction', () => {
 for (const [first,last,expected] of [['100','103',['100','101','102','103']],['100','97',['100','99','98','97']],['100','100',['100']]]) {
  const queue = range(first,last);
  assert.deepEqual(queue,expected);
  let ordered = {stage:'assign',first,last,current:queue[0]};
  for (const code of queue) {
   assert.equal(ordered.current,code);
   ordered = advance(ordered,code);
  }
  assert.equal(ordered.stage,'complete');
  assert.equal(ordered.current,null);
 }
 assert.equal(range('100','130').length,31);
 assert.equal(range('100','70').length,31);
});
test('range preserves padding and exact large values across digit boundaries', () => {
 assert.deepEqual(range('0099','0101'),['0099','0100','0101']);
 assert.deepEqual(range('1000','998'),['1000','999','998']);
 assert.deepEqual(range('90071992547409930','90071992547409932'),['90071992547409930','90071992547409931','90071992547409932']);
 assert.throws(()=>range('abc','100'));
 assert.throws(()=>advance({stage:'last',first:'100'},'102'));
 assert.throws(()=>advance({stage:'assign',first:'100',last:'102',current:'100'},'101'));
});
test('all four combinations of barcode and ID direction predict the second CD', () => {
 for (const [firstBarcode,lastBarcode,current] of [['900','904','901'],['904','900','903']]) {
  for (const [firstId,lastId,nextId] of [[100,104,101],[104,100,103]]) {
   const rows=Array.from({length:5},(_,i)=>({id:100+i,barcode:100+i===firstId?firstBarcode:100+i===lastId?lastBarcode:null}));
   const result=suggestAlbums(rows,firstBarcode,lastBarcode,current);
   assert.equal(result.albums[0].id,nextId);
   assert.ok(result.albums.every(a=>!a.barcode));
  }
 }
});
test('last CD assigned ahead never displaces the preceding interior anchor', () => {
 const rows=[{id:100,barcode:'900'},{id:101,barcode:'901'},
  {id:102,barcode:null},{id:103,barcode:null},{id:900,barcode:'904'},{id:899,barcode:null}];
 assert.equal(suggestAlbums(rows,'900','904','903').albums[0].id,102);
});
test('manual corrections, gaps, and shelf boundaries update the next suggestion', () => {
 const rows=[{id:100,barcode:'904',old_shelf:'1A'},{id:110,barcode:'903',old_shelf:'9Z'},
  {id:113,barcode:null,old_shelf:'2A'},{id:120,barcode:'900'},{id:114,barcode:'999'}];
 assert.equal(suggestAlbums(rows,'904','900','902').albums[0].id,113);
 rows[1].barcode=null; // Undo removes this anchor.
 assert.equal(suggestAlbums(rows,'904','900','903').albums[0].id,110);
});
test('endpoints and out-of-range barcodes are excluded; missing endpoints fail clearly', () => {
 const rows=[{id:1,barcode:'100'},{id:2,barcode:null},{id:3,barcode:'102'}];
 for (const barcode of ['99','100','102','103']) assert.deepEqual(suggestAlbums(rows,'100','102',barcode).albums,[]);
 assert.throws(()=>suggestAlbums(rows,'100','104','101'));
 assert.throws(()=>suggestAlbums(rows,'100','102','abc'));
});

test('page scans both endpoints before queuing and focuses assignment only after the last scan', async () => {
 const vm = require('node:vm');
 const html = require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const start = html.indexOf('barcodeInput.addEventListener("keydown", async');
 const end = html.indexOf('searchInput.addEventListener("input"', start);
 for (const [first,last] of [['100','130'],['100','70'],['001','001']]) {
  let handler, focus;
  const state = {busy:false,phase:'manual',ordered:{stage:'first'},orderedUndo:new Map(),barcodeQueue:[]};
  const input = {value:'',focus:()=>{focus='scan';},addEventListener:(_,fn)=>{handler=fn;}};
  vm.runInNewContext(html.slice(start,end), {
   state, barcodeInput:input, searchInput:{focus:()=>{focus='search';}},
   OrderedSearch:require('../ordered-search'), invalidateResults:()=>{},syncFlow:()=>{},
   setAssignStatus:()=>{},fetchJson:async()=>({assigned:false})
  });
  const scan = async code => {input.value=code;await handler({key:'Enter',preventDefault(){}});};
  await scan(first);
  assert.equal(state.ordered.stage,'last');
  assert.equal(state.barcodeQueue.length,0);
  assert.equal(focus,'scan');
  await scan(last);
  assert.deepEqual(state.barcodeQueue,range(first,last));
  assert.equal(state.ordered.current,first);
  assert.equal(focus,'search');
  const before = [...state.barcodeQueue];
  await scan('999');
  assert.deepEqual(state.barcodeQueue,before);
 }
});

test('queue controls remove ordered barcodes and reset endpoint capture when cleared', () => {
 const vm = require('node:vm');
 const html = require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const start = html.indexOf('    removeScanButton.addEventListener("click"');
 const end = html.indexOf('    sortBarcodeInput.addEventListener',start);
 for (const [first,last] of [['100','102'],['102','100'],['100','100']]) {
  let remove, clear;
  const state = {busy:false,phase:'manual',barcodeQueue:range(first,last),ordered:{stage:'assign',first,last,current:first},orderedUndo:new Map()};
  vm.runInNewContext(html.slice(start,end),{
   state,removeScanButton:{addEventListener:(_,fn)=>remove=fn},clearQueueButton:{addEventListener:(_,fn)=>clear=fn},
   barcodeInput:{value:'',focus(){}},searchInput:{focus(){}},invalidateResults(){},syncFlow(){},setAssignStatus(){},
   renderBarcodeQueue(){},updateAssignButton(){},updateSessionWidgets(){}
  });
  remove();
  assert.deepEqual(state.barcodeQueue,range(first,last).slice(1));
  if (state.barcodeQueue.length) {
   assert.equal(state.ordered.current,state.barcodeQueue[0]);
   assert.doesNotThrow(()=>advance(state.ordered,state.barcodeQueue[0]));
  } else assert.equal(state.ordered.stage,'first');
  clear();
  assert.equal(state.barcodeQueue.length,0);
  assert.equal(state.ordered.stage,'first');
  state.ordered={stage:'last',first};
  remove();
  assert.equal(state.ordered.stage,'first');
 }
});
