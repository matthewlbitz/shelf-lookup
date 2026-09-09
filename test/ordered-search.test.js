const test = require('node:test');
const assert = require('node:assert/strict');
const {advance, suggestAlbums, barcodeStep} = require('../ordered-search');

test('first and last are assigned before interior barcodes, in either direction', () => {
 for (const [first,last,expected] of [['900','904',['901','902','903']],['904','900',['903','902','901']]]) {
  let ordered = advance({stage:'first'}, first);
  assert.deepEqual(ordered,{stage:'last',first});
  ordered = advance(ordered,last);
  for (const code of expected) {
   assert.equal(ordered.current,code);
   ordered = advance(ordered,code);
  }
  assert.equal(ordered.stage,'complete');
  assert.equal(ordered.current,null);
 }
});
test('adjacent endpoints finish immediately; duplicate endpoints cannot assign', () => {
 assert.equal(advance(advance({stage:'first'},'900'),'901').stage,'complete');
 assert.equal(advance(advance({stage:'first'},'900'),'899').stage,'complete');
 assert.throws(()=>advance({stage:'last',first:'900'},'0900'));
});
test('barcodes retain explicit padding and exact large numbers, but do not invent padding', () => {
 assert.equal(advance({stage:'last',first:'00900'},'00930').current,'00901');
 let ordered=advance({stage:'last',first:'1000'},'997');
 assert.equal(ordered.current,'999');
 assert.equal(advance(ordered,'999').current,'998');
 assert.equal(advance({stage:'last',first:'90071992547409930'},'90071992547409960').current,'90071992547409931');
 assert.throws(()=>barcodeStep('abc','100'));
 assert.throws(()=>advance(ordered,'1001'));
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
