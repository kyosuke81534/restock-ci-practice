const test = require('node:test');
const assert = require('node:assert');
const { build } = require('./seed');
const { notifyRestocks } = require('./restock_batch');
function setup() {
  const db = build();
  for (const n of ['a', 'b', 'c']) db.prepare("INSERT INTO members (email,password_hash,customer_id,created_at) VALUES (?,?,?,?)").run(n + '@example.com', 'x', 'C000' + (n.charCodeAt(0) - 96), '2026-12-20');
  for (const m of [1, 2, 3]) db.prepare("INSERT INTO restock_requests (member_id,product_id,created_at) VALUES (?,?,?)").run(m, 'P018', '2026-12-2' + m);
  return db;
}
test('在庫0のあいだは、誰にも送らない', () => {
  const db = setup(); const mails = []; const r = notifyRestocks(db, (to, s) => mails.push(to));
  assert.strictEqual(r.sent.length, 0); assert.strictEqual(mails.length, 0);
});
test('在庫が2個入荷したら、登録の古い順に2人だけに送る', () => {
  const db = setup(); db.prepare("UPDATE stocks SET quantity=2 WHERE product_id='P018'").run();
  const mails = []; const r = notifyRestocks(db, (to) => mails.push(to));
  assert.deepStrictEqual(mails, ['a@example.com', 'b@example.com']);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM restock_requests WHERE status='waiting'").get().c, 1);
  const again = notifyRestocks(db, (to) => mails.push(to));                 // もう一度動かしても、在庫の数（2）を超えては送らない
  assert.strictEqual(again.sent.length, 0); assert.strictEqual(mails.length, 2);
  const nextDay = notifyRestocks(db, (to) => mails.push(to), () => '2026-12-27');   // 翌日、まだ在庫があれば、残りの人に送る
  assert.strictEqual(nextDay.sent.length, 1);
});
test('メール送信に失敗した人は、待ちのまま残り、次回また試される', () => {
  const db = setup(); db.prepare("UPDATE stocks SET quantity=3 WHERE product_id='P018'").run();
  const r = notifyRestocks(db, (to) => { if (to === 'b@example.com') throw new Error('メールサービスが応答しません'); });
  assert.strictEqual(r.sent.length, 2); assert.strictEqual(r.failed.length, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM restock_requests WHERE status='waiting'").get().c, 1);
  const ok = notifyRestocks(db, () => {});                                    // 次回は成功
  assert.strictEqual(ok.sent.length, 1);
});
test('送れない人がいても、後ろの人に、在庫の数だけ送る（失敗した人が、順番をふさがない）', () => {   // 第29章で見つけた問題への、再発防止
  const db = setup(); db.prepare("UPDATE stocks SET quantity=2 WHERE product_id='P018'").run();
  const mails = []; const r = notifyRestocks(db, (to) => { if (to === 'b@example.com') throw new Error('受信箱がいっぱいです'); mails.push(to); });
  assert.deepStrictEqual(mails, ['a@example.com', 'c@example.com']);          // b は送れないので飛ばし、在庫2個ぶん（a と c）に送る
  assert.strictEqual(r.failed.length, 1);
  assert.strictEqual(db.prepare("SELECT status FROM restock_requests WHERE member_id=2").get().status, 'waiting');   // b は、待ちのまま
  assert.strictEqual(notifyRestocks(db, () => {}).sent.length, 0);            // 同じ日に、もう一度動かしても、在庫の数を超えては送らない
});
