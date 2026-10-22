import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Controlled SI demonstration. This generator is NOT supplied to REA.
const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'shipped-legacy');
await mkdir(resolve(target, 'public'), { recursive: true });
await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'legacy-settlement', version: '1.0.0', type: 'module', engines: { node: '>=24.15' }, scripts: { start: 'node server.js' } }, null, 2));
await writeFile(resolve(target, 'server.js'), `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(new URL('./legacy.sqlite', import.meta.url).pathname);
db.exec('PRAGMA foreign_keys=ON');
function send(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
function settle(id,res){
 const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
 if(!order)return send(res,404,{code:'ORDER_NOT_FOUND'});
 if(order.status!=='PAID')return send(res,409,{code:'ORDER_NOT_PAID',status:order.status});
 if(db.prepare('SELECT id FROM settlements WHERE order_id=?').get(id))return send(res,409,{code:'ALREADY_SETTLED'});
 const fee=Math.ceil(order.gross_amount*order.commission_bps/10000);
 const net=order.gross_amount-fee;
 db.exec('BEGIN IMMEDIATE');
 try {
  const result=db.prepare('INSERT INTO settlements(order_id,gross_amount,fee_amount,net_amount) VALUES(?,?,?,?)').run(id,order.gross_amount,fee,net);
  db.prepare('UPDATE orders SET settled_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  db.prepare('INSERT INTO audit_log(event,order_id,detail) VALUES(?,?,?)').run('SETTLE_ORDER',id,JSON.stringify({settlement_id:Number(result.lastInsertRowid),fee,net}));
  db.exec('COMMIT');
  return send(res,201,{settlement_id:Number(result.lastInsertRowid),order_id:id,gross_amount:order.gross_amount,fee_amount:fee,net_amount:net});
 } catch(error){db.exec('ROLLBACK');return send(res,500,{code:'SETTLEMENT_FAILED'});}
}
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(req.method==='GET'&&path==='/api/orders')return send(res,200,db.prepare('SELECT o.*,c.name AS customer_name FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id').all());
 if(req.method==='GET'&&path==='/api/settlements')return send(res,200,db.prepare('SELECT * FROM settlements ORDER BY id').all());
 if(req.method==='GET'&&path==='/api/audit')return send(res,200,db.prepare('SELECT * FROM audit_log ORDER BY id').all());
 const match=path.match(/^\\/api\\/orders\\/(\\d+)\\/settle$/);
 if(req.method==='POST'&&match)return settle(Number(match[1]),res);
 if(req.method==='GET'&&(path==='/'||path==='/app.js')){
  const file=path==='/'?'index.html':'app.js';
  res.writeHead(200,{'Content-Type':path==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});
  return res.end(readFileSync(new URL('./public/'+file,import.meta.url)));
 }
 return send(res,404,{code:'NOT_FOUND'});
});
server.listen(Number(process.env.PORT||4318),'127.0.0.1',()=>console.log(JSON.stringify({ready:true,url:'http://127.0.0.1:'+server.address().port})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
`);
await writeFile(resolve(target, 'public/app.js'), `const rows=document.querySelector('#orders');
async function refresh(){const data=await fetch('/api/orders').then(r=>r.json());rows.innerHTML=data.map(o=>'<tr><td>'+o.id+'</td><td>'+o.customer_name+'</td><td>'+o.status+'</td><td>'+o.gross_amount.toLocaleString('ko-KR')+'</td><td>'+o.commission_bps+'</td><td><button id="settle-'+o.id+'" data-order="'+o.id+'">정산 실행</button></td></tr>').join('');rows.dataset.state='ready';}
rows.addEventListener('click',async(e)=>{const button=e.target.closest('button[data-order]');if(!button)return;const result=document.querySelector('#result');result.dataset.status='loading';const response=await fetch('/api/orders/'+button.dataset.order+'/settle',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await response.json();result.textContent=JSON.stringify({http_status:response.status,...data},null,2);result.dataset.status=String(response.status);});
document.querySelector('#show-settlements').addEventListener('click',async()=>{const data=await fetch('/api/settlements').then(r=>r.json());document.querySelector('#settlements').textContent=JSON.stringify(data,null,2);document.querySelector('#settlements').dataset.state='ready';});
refresh();
`);
await writeFile(resolve(target, 'public/index.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>주문·정산 운영 시스템</title><style>body{margin:0;background:#f1f5f9;color:#142037;font:16px system-ui}header{background:#142037;color:white;padding:30px 6%}main{max-width:1050px;margin:36px auto;padding:0 24px}.card{background:white;border:1px solid #dce3ed;border-radius:12px;padding:25px;margin-bottom:24px}h1{margin:8px 0}small{color:#9fb8da}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:14px 8px;border-bottom:1px solid #e7ecf2}th{color:#66738b;font-size:13px}button{border:0;border-radius:6px;background:#2157d5;color:white;padding:10px 14px;cursor:pointer}pre{white-space:pre-wrap;background:#f6f8fc;border-radius:8px;padding:18px;min-height:35px;font-size:14px}footer{color:#67738b;font-size:13px}</style><header><small>LEGACY OPERATIONS / LOCAL DEMO</small><h1>주문·정산 운영 시스템</h1><div>운영 화면과 배포 파일만 남아 있는 인수인계 대상</div></header><main><div class="card"><h2>주문 목록</h2><table><thead><tr><th>주문</th><th>거래처</th><th>상태</th><th>금액</th><th>수수료율 bps</th><th>처리</th></tr></thead><tbody id="orders" data-state="loading"></tbody></table></div><div class="card"><h2>처리 결과</h2><pre id="result" aria-live="polite">정산할 주문을 선택하세요.</pre><button id="show-settlements">정산 내역 조회</button><pre id="settlements"></pre></div><footer>합성 거래 데이터로 실행하는 REA 인수인계 검증용 시스템</footer></main><script type="module" src="/app.js"></script></html>`);
const db = new DatabaseSync(resolve(target, 'legacy.sqlite'));
db.exec(`PRAGMA foreign_keys=ON;
DROP TABLE IF EXISTS audit_log; DROP TABLE IF EXISTS settlements; DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS customers;
CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE orders(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),status TEXT NOT NULL CHECK(status IN ('PAID','PENDING','CANCELLED')),gross_amount INTEGER NOT NULL CHECK(gross_amount>0),commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),settled_at TEXT);
CREATE TABLE settlements(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),gross_amount INTEGER NOT NULL,fee_amount INTEGER NOT NULL,net_amount INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE audit_log(id INTEGER PRIMARY KEY,event TEXT NOT NULL,order_id INTEGER NOT NULL REFERENCES orders(id),detail TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_orders_status ON orders(status);
INSERT INTO customers VALUES(1,'데모상사'),(2,'샘플유통');
INSERT INTO orders(id,customer_id,status,gross_amount,commission_bps) VALUES(1001,1,'PAID',10001,350),(1002,1,'PENDING',125000,300),(1003,2,'CANCELLED',80000,300),(1004,2,'PAID',99000,300);`);
db.close();
console.log(JSON.stringify({prepared:target,note:'Synthetic shipped artifact; generator and docs excluded from REA input.'}));
