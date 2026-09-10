// サンプル物件のパラメータ。App.jsx のシミュレーション用パラメータと同じ形を保つ。
export const DEMO_PROPERTY_PARAMS = {
  // 物件
  price: 2480, costsPct: 7, bldgRatio: 45, depYears: 37,
  // 収入
  rent: 92000, rentDecline: 0.7, renewalEveryYears: 2, renewalOwnerMonths: 0.5,
  reikinMonths: 0,
  // 空室・退去
  stayYears: 5, vacancyMonths: 1.5, restorationCost: 120000, adMonths: 0.5,
  // 融資
  downPayment: 100, loanYears: 35, rate0: 0.8, rateSlope: 0.02, rateCap: 3.0,
  repayMethod: "annuity",
  // 経費
  mgmtPct: 4, bldgFee: 10000, bldgFeeInfl: 0.7, tax: 55000, insurance: 12000,
  otherAnnual: 0,
  // 修繕
  repairBase: 20000, repairInfl: 1.5, bigRepairCycle: 0, bigRepairCost: 100,
  // 税
  taxOn: false, taxRate: 30, lossOffset: true,
  // 売却
  saleOn: true, saleMode: "trend", exitYieldPct: 6, priceTrendPct: 0.5,
  sellCostPct: 4, capGainTaxOn: true,
  simYears: 35,
  equipment: [
    { name: "エアコン", cycle: 15, cost: 12, on: true, installYear: 2021 },
    { name: "給湯器", cycle: 12, cost: 18, on: true, installYear: 2021 },
    { name: "ガスコンロ", cycle: 15, cost: 6, on: true, installYear: 2021 },
    { name: "壁紙・床全面張替", cycle: 12, cost: 25, on: false, installYear: 2021 },
  ],
};

// サンプルのAI市場調査結果。api/research.js の応答と同じ形を保つ。
export const DEMO_RESEARCH = {
  rentDeclinePct: 0.8,
  stayYears: 4,
  vacancyMonths: 2,
  loanRatePct: 2.2,
  rateSlopePctPerYear: 0.08,
  priceTrendPct: -0.5,
  exitYieldPct: 5.5,
  reikinMonths: 1,
  renewalOwnerMonths: 0.5,
  adMonths: 1,
  mgmtPct: 5,
  restorationCostYen: 120000,
  repairInflPct: 2,
  summary: "東京都文京区の中古ワンルームを想定した操作体験用の参考値です。空室、金利上昇、家賃と価格の下落を保守的に置いています。実在の統計や個別物件の調査結果ではありません。",
  sources: ["サンプルデータ（操作体験用）"],
};
