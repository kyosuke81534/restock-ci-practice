const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { build } = require('./seed');
const { createApp, hashPassword, verifyPassword, checkPassword } = require('./server');

function start() {
  const db = build(); const server = http.createServer(createApp(db, () => '2026-12-25'));
  return new Promise((ok) => server.listen(0, () => ok({ db, server, port: server.address().port })));
}
function call(port, method, path, body, cookie) {
  return new Promise((ok) => {
    const req = http.request({ port, method, path, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => ok({ status: res.statusCode, body: d ? JSON.parse(d) : null, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }));
    });
    if (body) req.write(JSON.stringify(body)); req.end();
  });
}
test('パスワードは、読めない形で保存され、正しい入力だけが一致する', () => {
  const h = hashPassword('abc12345');
  assert.ok(!h.includes('abc12345')); assert.ok(verifyPassword('abc12345', h)); assert.ok(!verifyPassword('abc12346', h));
});
test('パスワード強度: 8文字未満・英字のみ・数字のみ は不可', () => {
  assert.ok(checkPassword('abc123')); assert.ok(checkPassword('abcdefgh')); assert.ok(checkPassword('12345678')); assert.strictEqual(checkPassword('abc12345'), null);
});
test('会員登録 → 重複 → ログイン → 在庫 → 再入荷通知 の流れ', async () => {
  const { server, port } = await start();
  let r = await call(port, 'POST', '/api/members', { email: 'a@example.com', password: 'abc12345' });
  assert.strictEqual(r.status, 201);
  r = await call(port, 'POST', '/api/members', { email: 'a@example.com', password: 'abc12345' });
  assert.strictEqual(r.status, 409);
  r = await call(port, 'POST', '/api/restock-requests', { productId: 'P018' });
  assert.strictEqual(r.status, 401);                                   // ログインしていない
  r = await call(port, 'POST', '/api/login', { email: 'a@example.com', password: 'abc12345' });
  assert.strictEqual(r.status, 200); const cookie = r.cookie;
  r = await call(port, 'POST', '/api/restock-requests', { productId: 'P018' }, cookie);
  assert.strictEqual(r.status, 201);
  r = await call(port, 'POST', '/api/restock-requests', { productId: 'P018' }, cookie);
  assert.strictEqual(r.status, 409);                                   // 二重登録
  r = await call(port, 'GET', '/api/admin/members', null, cookie);
  assert.strictEqual(r.status, 403);                                   // 管理者ではない
  server.close();
});
test('購入: ポイントが足りないとき、注文も在庫も変わらない（トランザクション）', async () => {
  const { db, server, port } = await start();
  await call(port, 'POST', '/api/members', { email: 'b@example.com', password: 'abc12345' });
  const login = await call(port, 'POST', '/api/login', { email: 'b@example.com', password: 'abc12345' });
  const before = db.prepare("SELECT quantity FROM stocks WHERE product_id='P001'").get().quantity;
  const r = await call(port, 'POST', '/api/orders', { productId: 'P001', quantity: 1, usePoints: 500 }, login.cookie);
  assert.strictEqual(r.status, 422);
  assert.strictEqual(db.prepare("SELECT quantity FROM stocks WHERE product_id='P001'").get().quantity, before);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM orders').get().c, 3300);
  server.close();
});

test('一覧（絞り込み・ページ分け）・取り消し・一部変更', async () => {
  const { server, port } = await start();
  await call(port, 'POST', '/api/members', { email: 'c@example.com', password: 'abc12345' });
  const login = await call(port, 'POST', '/api/login', { email: 'c@example.com', password: 'abc12345' });
  const ck = login.cookie;
  for (const id of ['P018', 'P027', 'P001']) await call(port, 'POST', '/api/restock-requests', { productId: id }, ck);
  let r = await call(port, 'GET', '/api/restock-requests?limit=2&offset=0', null, ck);
  assert.strictEqual(r.body.total, 3); assert.strictEqual(r.body.items.length, 2);
  r = await call(port, 'GET', '/api/restock-requests?limit=2&offset=2', null, ck);
  assert.strictEqual(r.body.items.length, 1);
  r = await call(port, 'GET', '/api/restock-requests?limit=0', null, ck);
  assert.strictEqual(r.status, 422);
  r = await call(port, 'DELETE', '/api/restock-requests/2', null, ck);
  assert.strictEqual(r.status, 204);
  r = await call(port, 'GET', '/api/restock-requests?status=waiting', null, ck);
  assert.strictEqual(r.body.total, 2);
  r = await call(port, 'PATCH', '/api/me', { displayName: 'はなこ' }, ck);
  assert.strictEqual(r.status, 200);
  r = await call(port, 'PATCH', '/api/me', { displayName: '' }, ck);
  assert.strictEqual(r.status, 422);
  server.close();
});
test('他人の登録は、取り消せない（認可）', async () => {
  const { server, port } = await start();
  await call(port, 'POST', '/api/members', { email: 'd1@example.com', password: 'abc12345' });
  await call(port, 'POST', '/api/members', { email: 'd2@example.com', password: 'abc12345' });
  const l1 = await call(port, 'POST', '/api/login', { email: 'd1@example.com', password: 'abc12345' });
  const l2 = await call(port, 'POST', '/api/login', { email: 'd2@example.com', password: 'abc12345' });
  const made = await call(port, 'POST', '/api/restock-requests', { productId: 'P018' }, l1.cookie);
  const r = await call(port, 'DELETE', '/api/restock-requests/' + made.body.requestId, null, l2.cookie);
  assert.strictEqual(r.status, 403);
  server.close();
});
