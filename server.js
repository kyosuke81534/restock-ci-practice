// ミライ会員サービス: API の参照実装（本の説明を確かめるための小さなサーバー。外部ライブラリなし）
const http = require('http');
const crypto = require('crypto');
const { build } = require('./seed');
const { calcPoints } = require('./points');

// ---- パスワード: 読めない形（ハッシュ）にして保存する ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  const [, salt, hash] = stored.split('$');
  const h = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
// ---- 入力チェック（サーバー側で必ず行う）----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '8文字以上にしてください';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '英字と数字の両方を入れてください';
  return null;
}

function createApp(db, clock = () => new Date().toISOString().slice(0, 10), log = null) {
  const sessions = new Map(); // セッションID → 会員ID（本番では、DBやRedisなどに置く）
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok(null); } }); });
  const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => c.trim().split('=')));
  const me = (req) => { const sid = cookieOf(req).sid; const id = sessions.get(sid); return id ? db.prepare('SELECT * FROM members WHERE member_id=? AND status=\'active\'').get(id) : null; };

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const t0 = Date.now();
    // 1件のお願いごとに、「いつ・何を・結果・何ミリ秒」を記録する（パスワードなどの中身は、記録しない）
    if (log) res.on('finish', () => log({ level: res.statusCode >= 500 ? 'error' : 'info', method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - t0 }));
    try {
      // 会員登録
      if (route === 'POST /api/members') {
        const b = await readBody(req);
        if (!b) return json(res, 400, { error: 'BAD_JSON', message: '送られたデータの形式が正しくありません' });
        if (!EMAIL_RE.test(b.email || '')) return json(res, 422, { error: 'INVALID_EMAIL', message: 'メールアドレスの形式が正しくありません' });
        const pwErr = checkPassword(b.password);
        if (pwErr) return json(res, 422, { error: 'WEAK_PASSWORD', message: pwErr });
        if (db.prepare('SELECT 1 FROM members WHERE email=?').get(b.email)) return json(res, 409, { error: 'EMAIL_TAKEN', message: 'このメールアドレスは、すでに登録されています' });
        let customerId = b.customerId || null;
        db.exec('BEGIN');
        try {
          if (customerId) {
            if (!db.prepare('SELECT 1 FROM customers WHERE customer_id=?').get(customerId)) { db.exec('ROLLBACK'); return json(res, 404, { error: 'CUSTOMER_NOT_FOUND', message: '顧客IDが見つかりません' }); }
            if (db.prepare('SELECT 1 FROM members WHERE customer_id=?').get(customerId)) { db.exec('ROLLBACK'); return json(res, 409, { error: 'CUSTOMER_TAKEN', message: 'この顧客IDは、すでに会員と結びついています' }); }
          } else {
            const n = db.prepare('SELECT COUNT(*) c FROM customers').get().c + 1;
            customerId = 'C' + String(n).padStart(4, '0');
            db.prepare('INSERT INTO customers (customer_id, name, registered_at) VALUES (?,?,?)').run(customerId, b.displayName || '(未設定)', clock());
          }
          const r = db.prepare('INSERT INTO members (email, password_hash, display_name, customer_id, created_at) VALUES (?,?,?,?,?)').run(b.email, hashPassword(b.password), b.displayName || null, customerId, clock());
          db.exec('COMMIT');
          return json(res, 201, { memberId: Number(r.lastInsertRowid), email: b.email, customerId });
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      // ログイン
      if (route === 'POST /api/login') {
        const b = (await readBody(req)) || {};
        const m = db.prepare('SELECT * FROM members WHERE email=? AND status=\'active\'').get(b.email || '');
        // 「メールが無い」と「パスワードが違う」を、同じ答えにする（どちらが違うかを教えない）
        if (!m || !verifyPassword(b.password || '', m.password_hash)) return json(res, 401, { error: 'LOGIN_FAILED', message: 'メールアドレスまたはパスワードが違います' });
        const sid = crypto.randomBytes(24).toString('hex');
        sessions.set(sid, m.member_id);
        return json(res, 200, { memberId: m.member_id }, { 'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax` });
      }
      if (route === 'POST /api/logout') { sessions.delete(cookieOf(req).sid); return json(res, 204 === 0 ? 0 : 200, { ok: true }, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/' }); }
      // 商品と在庫（誰でも見られる）
      let m1 = /^GET \/api\/products\/(P\d+)$/.exec(route);
      if (m1) {
        const p = db.prepare('SELECT p.product_id id, p.name, p.price, s.quantity stock FROM products p JOIN stocks s USING (product_id) WHERE p.product_id=?').get(m1[1]);
        return p ? json(res, 200, { ...p, inStock: p.stock > 0 }) : json(res, 404, { error: 'PRODUCT_NOT_FOUND', message: '商品が見つかりません' });
      }
      // ここから先は、ログインが必要
      const user = me(req);
      if (!user) return json(res, 401, { error: 'LOGIN_REQUIRED', message: 'ログインしてください' });
      if (route === 'GET /api/me/points') {
        const bal = db.prepare('SELECT COALESCE(SUM(points),0) s FROM point_history WHERE member_id=?').get(user.member_id).s;
        const history = db.prepare('SELECT order_id orderId, points, reason, created_at createdAt FROM point_history WHERE member_id=? ORDER BY history_id DESC LIMIT 20').all(user.member_id);
        return json(res, 200, { balance: bal, history });
      }
      if (route === 'GET /api/restock-requests') { // 自分の登録の一覧（絞り込みと、ページ分けつき）
        const status = url.searchParams.get('status');
        const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) return json(res, 422, { error: 'INVALID_PARAMETER', message: 'limit・offsetの値が正しくありません' });
        const where = status ? 'AND r.status = ?' : '';
        const args = status ? [user.member_id, status] : [user.member_id];
        const total = db.prepare(`SELECT COUNT(*) c FROM restock_requests r WHERE r.member_id = ? ${where}`).get(...args).c;
        const items = db.prepare(`SELECT r.request_id requestId, r.product_id productId, p.name productName, r.status, r.created_at createdAt FROM restock_requests r JOIN products p USING (product_id) WHERE r.member_id = ? ${where} ORDER BY r.request_id LIMIT ? OFFSET ?`).all(...args, limit, offset);
        return json(res, 200, { total, limit, offset, items });
      }
      let m2 = /^DELETE \/api\/restock-requests\/(\d+)$/.exec(route);
      if (m2) { // 登録の取り消し（自分の登録だけ）
        const r = db.prepare('SELECT * FROM restock_requests WHERE request_id=?').get(Number(m2[1]));
        if (!r) return json(res, 404, { error: 'REQUEST_NOT_FOUND', message: '登録が見つかりません' });
        if (r.member_id !== user.member_id) return json(res, 403, { error: 'FORBIDDEN', message: 'この操作を行う権限がありません' });
        db.prepare("UPDATE restock_requests SET status='cancelled' WHERE request_id=?").run(r.request_id);
        res.writeHead(204); return res.end();
      }
      if (route === 'PATCH /api/me') { // 表示名の変更（送られた項目だけを、変える）
        const b = (await readBody(req)) || {};
        if (typeof b.displayName !== 'string' || b.displayName.length < 1 || b.displayName.length > 30) return json(res, 422, { error: 'INVALID_DISPLAY_NAME', message: '表示名は1〜30文字で入力してください' });
        db.prepare('UPDATE members SET display_name=? WHERE member_id=?').run(b.displayName, user.member_id);
        return json(res, 200, { memberId: user.member_id, displayName: b.displayName });
      }
      if (route === 'POST /api/restock-requests') {
        const b = (await readBody(req)) || {};
        const p = db.prepare('SELECT 1 FROM products WHERE product_id=?').get(b.productId || '');
        if (!p) return json(res, 404, { error: 'PRODUCT_NOT_FOUND', message: '商品が見つかりません' });
        try {
          const r = db.prepare('INSERT INTO restock_requests (member_id, product_id, created_at) VALUES (?,?,?)').run(user.member_id, b.productId, clock());
          return json(res, 201, { requestId: Number(r.lastInsertRowid), productId: b.productId, status: 'waiting' });
        } catch (e) {
          if (String(e.message).includes('UNIQUE')) return json(res, 409, { error: 'ALREADY_WAITING', message: 'この商品は、すでに再入荷通知を登録しています' });
          throw e;
        }
      }
      if (route === 'POST /api/orders') { // 購入。ポイントの利用・付与・注文の記録を「ひとかたまり」で行う（トランザクション）
        const b = (await readBody(req)) || {};
        const p = db.prepare('SELECT * FROM products WHERE product_id=?').get(b.productId || '');
        const q = Number(b.quantity);
        if (!p || !Number.isInteger(q) || q < 1) return json(res, 422, { error: 'INVALID_ORDER', message: '商品または数量が正しくありません' });
        const pct = Number(b.discountPercent || 0);
        db.exec('BEGIN');
        try {
          const st = db.prepare('SELECT quantity FROM stocks WHERE product_id=?').get(p.product_id);
          if (st.quantity < q) { db.exec('ROLLBACK'); return json(res, 409, { error: 'OUT_OF_STOCK', message: '在庫が足りません' }); }
          const usePts = Number(b.usePoints || 0);
          const bal = db.prepare('SELECT COALESCE(SUM(points),0) s FROM point_history WHERE member_id=?').get(user.member_id).s;
          if (usePts > bal) { db.exec('ROLLBACK'); return json(res, 422, { error: 'NOT_ENOUGH_POINTS', message: 'ポイントが足りません' }); }
          const orderId = 'O' + String(db.prepare('SELECT COUNT(*) c FROM orders').get().c + 1).padStart(5, '0');
          db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)').run(orderId, clock(), user.customer_id, p.product_id, q, pct / 100, 'クレジットカード', 2);
          db.prepare('UPDATE stocks SET quantity = quantity - ?, updated_at=? WHERE product_id=?').run(q, clock(), p.product_id);
          if (usePts > 0) db.prepare('INSERT INTO point_history (member_id, order_id, points, reason, created_at) VALUES (?,?,?,?,?)').run(user.member_id, orderId, -usePts, 'use', clock());
          const earned = calcPoints(p.price, q, pct);
          db.prepare('INSERT INTO point_history (member_id, order_id, points, reason, created_at) VALUES (?,?,?,?,?)').run(user.member_id, orderId, earned, 'purchase', clock());
          db.prepare('UPDATE members SET last_purchase_at=? WHERE member_id=?').run(clock(), user.member_id);
          db.exec('COMMIT');
          return json(res, 201, { orderId, earnedPoints: earned, usedPoints: usePts });
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      if (route === 'GET /api/admin/members') {
        if (!user.is_admin) return json(res, 403, { error: 'FORBIDDEN', message: 'この操作を行う権限がありません' });
        const rows = db.prepare('SELECT member_id memberId, email, status FROM members ORDER BY member_id LIMIT 50').all();
        return json(res, 200, { members: rows });
      }
      return json(res, 404, { error: 'NOT_FOUND', message: 'そのURLはありません' });
    } catch (e) {
      if (log) log({ level: 'error', msg: e.message, path: url.pathname }); else console.error('[ERROR]', e.message);
      return json(res, 500, { error: 'INTERNAL', message: 'サーバーでエラーが起きました' }); // 内部の詳細は、利用者に見せない
    }
  };
}
module.exports = { createApp, hashPassword, verifyPassword, checkPassword };
