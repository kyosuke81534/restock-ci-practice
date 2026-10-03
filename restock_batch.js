// 再入荷メールを送るバッチ（定期的に動く、画面のない処理）。
// ルール（8章・未決事項Q3の「仮の扱い」）: 同じ日に、在庫の数を超える人数には通知しない。登録の古い順。残りは、待ち続ける。
// （何度動かしても、在庫の数を超えて通知しないよう、「今日、すでに通知した人数」を、在庫の数から引く）
function notifyRestocks(db, mailer, now = () => '2026-12-26') {
  const sent = [], failed = [];
  const products = db.prepare("SELECT s.product_id id, p.name, s.quantity FROM stocks s JOIN products p USING (product_id) WHERE s.quantity > 0 AND EXISTS (SELECT 1 FROM restock_requests r WHERE r.product_id = s.product_id AND r.status='waiting')").all();
  for (const p of products) {
    const today = now();
    const done = db.prepare("SELECT COUNT(*) c FROM restock_requests WHERE product_id=? AND status='notified' AND notified_at=?").get(p.id, today).c;
    const room = Math.max(0, p.quantity - done);                                    // 今日、あと何人まで通知してよいか
    const waiting = db.prepare("SELECT r.request_id, m.email FROM restock_requests r JOIN members m USING (member_id) WHERE r.product_id=? AND r.status='waiting' ORDER BY r.request_id").all(p.id);   // 古い順（人数の上限は、ここでは付けない）
    let remaining = room;
    for (const w of waiting) {
      if (remaining <= 0) break;                                                           // 送れた人数が、今日の上限に達したら、終わり
      try { mailer(w.email, `【ミライ雑貨店】${p.name}が再入荷しました`); }
      catch (e) { failed.push({ requestId: w.request_id, reason: e.message }); continue; }   // 送れなかった人は「待ち」のまま残し、次の人へ進む（次回また試す）
      db.prepare("UPDATE restock_requests SET status='notified', notified_at=? WHERE request_id=?").run(now(), w.request_id);
      sent.push({ requestId: w.request_id, to: w.email, product: p.id });
      remaining--;
    }
  }
  return { sent, failed };
}
module.exports = { notifyRestocks };
