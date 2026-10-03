const test = require('node:test');
const assert = require('node:assert');
const { calcPoints, calcPointsNaive } = require('./points');

// 手計算の見本（実際の注文データより）: [注文ID, 単価, 数量, 割引(%), 期待するポイント]
const samples = [
  ['O00001', 2600, 1, 0, 26], ['O00028', 700, 2, 0, 14], ['O00195', 3800, 3, 0, 114],
  ['O00002', 3800, 1, 5, 36], ['O00120', 2200, 2, 5, 41], ['O00003', 3800, 1, 10, 34],
  ['O00013', 580, 2, 10, 10], ['O00010', 1300, 1, 20, 10], ['O00023', 1500, 3, 20, 36], ['O00007', 1900, 1, 30, 13],
];
for (const [id, price, q, pct, expected] of samples) {
  test(`正常系: ${id} 単価${price}×${q}個 ${pct}%引き → ${expected}ポイント`, () => assert.strictEqual(calcPoints(price, q, pct), expected));
}
test('境界値: ちょうど100円 → 1ポイント / 99円 → 0ポイント', () => { assert.strictEqual(calcPoints(100, 1, 0), 1); assert.strictEqual(calcPoints(99, 1, 0), 0); });
test('境界値: 2,200円×5個 30%引き = 7,700円 → 77ポイント（小数のまま計算すると76になる）', () => {
  assert.strictEqual(calcPoints(2200, 5, 30), 77);
  assert.strictEqual(calcPointsNaive(2200, 5, 0.3), 76); // バグを含む書き方は、76になる（確認用）
});
test('異常系: 割引が100%なら0ポイント', () => assert.strictEqual(calcPoints(1000, 1, 100), 0));
