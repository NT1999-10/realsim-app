// ---------- simulation ----------
export function simulate(p, realistic) {
  let balance = Math.max(p.price * 10000 - p.downPayment * 10000, 0);
  const loan0 = balance;
  const totalM = p.loanYears * 12;
  let remain = totalM;
  let occupied = true;
  let stateLeft = Math.max(1, Math.round(p.stayYears * 12));
  let tenancyM = 0; // 入居継続月数(更新料用)
  let accumDep = 0;
  const depAnnual = (p.price * 10000 * p.bldgRatio / 100) / Math.max(1, p.depYears);
  const years = [];
  let cum = 0;

  for (let y = 1; y <= p.simYears; y++) {
    const rate = realistic
      ? Math.min(p.rate0 + p.rateSlope * (y - 1), p.rateCap)
      : p.rate0;
    const mr = rate / 100 / 12;
    let pay = 0;
    if (balance > 0 && remain > 0 && p.repayMethod === "annuity") {
      pay = mr === 0 ? balance / remain
        : (balance * mr) / (1 - Math.pow(1 + mr, -remain));
    }
    const rent = realistic ? p.rent * Math.pow(1 - p.rentDecline / 100, y - 1) : p.rent;
    const repairY = realistic ? p.repairBase * Math.pow(1 + p.repairInfl / 100, y - 1) : p.repairBase;
    const bldgFeeM = realistic ? p.bldgFee * Math.pow(1 + p.bldgFeeInfl / 100, y - 1) : p.bldgFee;

    let income = 0, expense = 0, loanPaid = 0, interestPaid = 0;

    for (let m = 0; m < 12; m++) {
      if (realistic) {
        if (stateLeft <= 0) {
          if (occupied) {
            occupied = false; tenancyM = 0;
            stateLeft = Math.max(0, Math.round(p.vacancyMonths));
            expense += p.restorationCost;
            if (stateLeft === 0) {
              occupied = true;
              stateLeft = Math.max(1, Math.round(p.stayYears * 12));
              expense += rent * p.adMonths;
              income += rent * p.reikinMonths;
            }
          } else {
            occupied = true;
            stateLeft = Math.max(1, Math.round(p.stayYears * 12));
            expense += rent * p.adMonths;
            income += rent * p.reikinMonths;
          }
        }
      } else occupied = true;

      if (occupied) {
        income += rent;
        expense += rent * (p.mgmtPct / 100);
        tenancyM += 1;
        // 更新料(貸主受取分)
        if (realistic && p.renewalEveryYears > 0 && tenancyM > 0 &&
            tenancyM % Math.round(p.renewalEveryYears * 12) === 0) {
          income += rent * p.renewalOwnerMonths;
        }
      }
      stateLeft -= 1;

      expense += bldgFeeM;
      expense += (p.tax + p.insurance + p.otherAnnual) / 12;
      expense += repairY / 12;

      if (balance > 0 && remain > 0) {
        const interest = balance * mr;
        let principal;
        if (p.repayMethod === "annuity") principal = Math.min(pay - interest, balance);
        else principal = Math.min(loan0 / totalM, balance); // 元金均等
        balance -= principal;
        loanPaid += interest + principal;
        interestPaid += interest;
        remain -= 1;
      }
    }

    // 設備交換・大規模修繕(現実のみ)
    let capexCost = 0;
    if (realistic) {
      for (const eq of p.equipment) {
        if (eq.on && eq.cycle > 0 && y % eq.cycle === 0) capexCost += eq.cost * 10000;
      }
      if (p.bigRepairCycle > 0 && y % p.bigRepairCycle === 0) capexCost += p.bigRepairCost * 10000;
    }
    expense += capexCost;

    // 減価償却・税(簡易)
    let dep = 0, taxPaid = 0;
    if (y <= p.depYears) { dep = depAnnual; accumDep += dep; }
    if (p.taxOn && realistic) {
      const taxable = income - (expense - 0) - interestPaid - dep; // 元金は損金不算入
      taxPaid = p.lossOffset
        ? taxable * (p.taxRate / 100)               // 損益通算(赤字なら還付)
        : Math.max(0, taxable) * (p.taxRate / 100);
    }

    const cf = income - expense - loanPaid - taxPaid;
    cum += cf;
    years.push({
      year: y, income, expense, loanPaid, interestPaid, dep, taxPaid,
      cf, cum, balance, rate, rentMonthly: rent, accumDep,
    });
  }
  return years;
}

export function saleAnalysis(p, real) {
  const last = real[real.length - 1];
  let salePrice;
  if (p.saleMode === "yield") {
    salePrice = (last.rentMonthly * 12) / Math.max(0.1, p.exitYieldPct / 100);
  } else {
    salePrice = p.price * 10000 * Math.pow(1 + p.priceTrendPct / 100, p.simYears);
  }
  const sellCost = salePrice * (p.sellCostPct / 100);
  const book = p.price * 10000 - last.accumDep;
  const gain = salePrice - sellCost - book;
  const capTax = p.capGainTaxOn ? Math.max(0, gain) * 0.20315 : 0;
  const netSale = salePrice - sellCost - last.balance - capTax;
  const initialEquity = (p.downPayment + p.price * (p.costsPct / 100)) * 10000;
  return { salePrice, sellCost, capTax, netSale, initialEquity,
           total: last.cum + netSale - initialEquity };
}

// ---------- 投資指標 ----------
export function irrOf(flows) {
  const npv = (r) => flows.reduce((s, c, i) => s + c / Math.pow(1 + r, i), 0);
  let lo = -0.95, hi = 2.0;
  if (npv(lo) * npv(hi) > 0) return null; // 解なし(全期間赤字など)
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

export function computeMetrics(q) {
  const real = simulate(q, true);
  const sale = saleAnalysis(q, real);
  const y1 = real[0];
  const flows = [-sale.initialEquity,
    ...real.map((r, i) => r.cf + (i === real.length - 1 ? sale.netSale : 0))];
  const irr = irrOf(flows);
  const ccr = sale.initialEquity > 0 ? (y1.cf / sale.initialEquity) * 100 : null;
  const noi1 = y1.income - y1.expense; // 営業純収益(初年度)
  const dscr = y1.loanPaid > 0 ? noi1 / y1.loanPaid : null;
  const firstDef = real.find((r) => r.cf < 0);
  return {
    irr, ccr, dscr,
    firstDeficitYear: firstDef ? firstDef.year : null,
    cumFinal: real[real.length - 1].cum,
    total: sale.total, sale, real,
  };
}

// 売却年を総当たりして「何年目に売るのが最適か」を算出
export function exitCurve(q) {
  const real = simulate(q, true);
  const initialEquity = (q.downPayment + q.price * (q.costsPct / 100)) * 10000;
  const pts = [];
  for (let y = 3; y <= q.simYears; y++) {
    const r = real[y - 1];
    const salePrice = q.saleMode === "yield"
      ? (r.rentMonthly * 12) / Math.max(0.1, q.exitYieldPct / 100)
      : q.price * 10000 * Math.pow(1 + q.priceTrendPct / 100, y);
    const sellCost = salePrice * (q.sellCostPct / 100);
    const book = q.price * 10000 - r.accumDep;
    const capTax = q.capGainTaxOn
      ? Math.max(0, salePrice - sellCost - book) * 0.20315 : 0;
    const net = salePrice - sellCost - r.balance - capTax;
    pts.push({ year: y, 総合損益: Math.round((r.cum + net - initialEquity) / 10000) });
  }
  return pts;
}
