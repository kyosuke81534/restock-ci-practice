// ポイント計算の「ルール」（PM編 6-1: 100円につき1ポイント。端数は切り捨て）
// 割引率は、小数（0.3）ではなく、整数のパーセント（30）で受け取る。
function calcAmount(price, quantity, discountPercent) {
  return Math.floor(price * quantity * (100 - discountPercent) / 100); // 支払う金額（円）。整数どうしで計算する
}
function calcPoints(price, quantity, discountPercent) {
  return Math.floor(calcAmount(price, quantity, discountPercent) / 100);
}
// 比べるための「ありがちな書き方」（小数のまま計算する）。バグを含む。
function calcPointsNaive(price, quantity, discountRate) {
  return Math.floor(Math.floor(price * quantity * (1 - discountRate)) / 100);
}
module.exports = { calcAmount, calcPoints, calcPointsNaive };
