import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtMoney, fmtNum, formatShortNumber, marketItemName, commodityBars, miniChart } from "../core/utils.js";
import { toast } from "../ui/toast.js";
import * as cap from "../core/captureReport.js";

export async function fetchTxLast24h(type, k, maxPages=8) {
  const cutoff=Date.now()-86400000;
  const items=[]; let cursor;
  for (let p=0;p<maxPages;p++) {
    let res;
    try { res=await fetchTrpc("transaction.getPaginatedTransactions",{limit:100,transactionType:type,cursor},k); }
    catch { break; }
    const data=unwrap(res);
    const page=Array.isArray(data)?data:(data?.items||[]);
    if (!page.length) break;
    let old=false;
    for (const t of page) {
      const ts=new Date(t.createdAt||t.date||t.timestamp||0).getTime();
      if (Number.isFinite(ts)&&ts>0&&ts<cutoff){old=true;continue;}
      items.push(t);
    }
    cursor=data?.nextCursor||data?.cursor||null;
    if (old||!cursor) break;
  }
  return items;
}

export function txAmt(t) { const v=Number(t.amount??t.value??t.money??t.total??t.price??0); return Number.isFinite(v)?v:0; }

export function loadMarketStats() {
  const k=apiKey(); if(!k) return;
  try {
    fetchTxLast24h("wage",k).then(wages => {
      if (!wages.length) return;
      const totalPayroll = wages.reduce((s,t)=>s+Number(t.money??t.amount??t.value??0),0);
      const totalQuantity = wages.reduce((s,t)=>s+Number(t.quantity??t.workerCount??0),0);
      const avgWage = totalQuantity > 0 ? totalPayroll / totalQuantity : 0;
      const avgPayroll = wages.length > 0 ? totalPayroll / wages.length : 0;
      E.statAvgWage.textContent = fmtMoney(avgWage, 3) + " ₿";
      E.statTotalWage.textContent = fmtMoney(avgPayroll) + " ₿";
    });
    fetchTxLast24h("trading",k).then(trades => {
      if (trades.length) E.statTradeVol.textContent=fmtMoney(trades.reduce((s,t)=>s+txAmt(t),0))+" ₿";
    });
    if (S.market.topValuable?.length) {
      const top = S.market.topValuable[0];
      E.statTopItem.textContent = `${top.item}:  ${formatShortNumber(top.value)}`;
    }
  } catch {}
}

export async function loadMarketFull(showLoading=true) {
  const k=apiKey(); if(!k) return;
  function setMs(el,msg,err=false) { el.hidden=false; el.textContent=msg; el.classList.toggle("error",err); }
  function clrMs(el) { el.hidden=true; el.textContent=""; el.classList.remove("error"); }
  if(showLoading){
    setMs(E.marketEconStatus,"Loading economic data…");
    setMs(E.marketPricesStatus,"Loading commodity prices…");
    setMs(E.marketOrdersStatus,"Loading trading orders…");
  }

  const [wagesR,tradesR,pricesR] = await Promise.allSettled([
    fetchTxLast24h("wage",k),
    fetchTxLast24h("trading",k),
    fetchTrpc("itemTrading.getPrices",{},k),
  ]);

  try {
    const wages=wagesR.status==="fulfilled"?wagesR.value:[];
    const trades=tradesR.status==="fulfilled"?tradesR.value:[];
    const totalPayroll = wages.reduce((s,t)=>s+Number(t.money??t.amount??t.value??0),0);
    const totalQuantity = wages.reduce((s,t)=>s+Number(t.quantity??t.workerCount??0),0);
    const avgWage = totalQuantity > 0 ? totalPayroll / totalQuantity : 0;
    const avgPayroll = wages.length > 0 ? totalPayroll / wages.length : 0;
    const tradeVol=trades.reduce((s,t)=>s+txAmt(t),0);
    S.market.econ = { avgWage, avgPayroll, totalPayroll, totalQuantity, tradeVol, wageCount:wages.length, tradeCount:trades.length };

    const wageByH={};
    for (const t of wages) {
      const h=new Date(t.createdAt||t.date||0).toISOString().slice(0,16);
      if(!wageByH[h]){ wageByH[h] = { payroll:0, qty:0 }; }
      wageByH[h].payroll += Number(t.money || 0);
      wageByH[h].qty += Number(t.quantity || 0);
    }

    S.market.wageHistory = Object.entries(wageByH).sort((a,b)=>a[0].localeCompare(b[0])).map(([h,v])=>({ h, avg: v.qty > 0 ? v.payroll / v.qty : 0 }));
    S.market.wageHistory.push({ t: Date.now(), avg: avgWage });

    E.marketEconData.innerHTML=[
      { label:"Avg Wage (24h)", value:fmtMoney(avgWage, 3)+" ₿" },
      { label:"Avg Payroll (Txn)", value:fmtMoney(avgPayroll)+" ₿" },
      { label:"Total Payroll (24h)", value:fmtMoney(totalPayroll)+" ₿" },
      { label:"Total Work Done (24h)", value:fmtNum(totalQuantity) },
      { label:"Wage Transactions", value:fmtNum(wages.length) },
      { label:"Trade Volume (24h)", value:fmtMoney(tradeVol)+" ₿" },
      { label:"Trade Transactions", value:fmtNum(trades.length) }
    ].map(r=>`<div class="econ-row"><span class="econ-row-label">${r.label}</span><span class="econ-row-val">${r.value}</span></div>`).join("");

    if (S.market.wageHistory.length>1) {
      E.marketEconData.innerHTML+=miniChart(S.market.wageHistory.map(w=>w.avg),"Avg Wage by Hour (₿)","var(--accent)");
    }
    clrMs(E.marketEconStatus);
  } catch(e) { setMs(E.marketEconStatus,"Could not load economic data: "+(e.message||""),true); }

  try {
    const prices=unwrap(pricesR.value);
    const arr=(Array.isArray(prices)?prices:Object.entries(prices||{}).map(([k,v])=>({itemCode:k,price:v})))
      .sort((a,b)=>Number(b.price||b.value||0)-Number(a.price||a.value||0));
    S.market.prices=arr;
    const pi=arr.slice(0,10).reduce((s,i)=>s+Number(i.price||i.value||0),0)/Math.min(10,arr.length);
    S.market.priceHistory.push({t:Date.now(),i:pi});
    if(S.market.priceHistory.length>48) S.market.priceHistory.shift();
    E.marketPricesData.innerHTML=arr.slice(0,30).map(item=>{
      const name=marketItemName(item.itemCode||item.item||item.name||"Unknown");
      const price=Number(item.price||item.value||0);
      return `<div class="price-row"><span class="price-name">${name}</span><span class="price-val">${fmtMoney(price)} ₿</span></div>`;
    }).join("")||"<p style='color:var(--ink-dim)'>No price data.</p>";
    E.marketPricesChart.innerHTML = miniChart(S.market.priceHistory.map(p=>p.i),"Price Index (Top-10 Avg ₿)","var(--blue)");
    clrMs(E.marketPricesStatus);
  } catch { setMs(E.marketPricesStatus,"Could not load price data.",true); }

  let commodityOrders=[];
  let equipmentOrders=[];
  let allOrders=[];

  try {
    const topItems = (S.market.prices||[]).slice(0,10).map(i=>i.itemCode||i.item||i.name).filter(Boolean);
    if (topItems.length) {
      const rs = await Promise.allSettled(topItems.map(ic => fetchTrpc("tradingOrder.getTopOrders", { itemCode:ic, limit:20 }, k)));
      for (let i=0;i<rs.length;i++) {
        if (rs[i].status==="fulfilled") {
          const d = unwrap(rs[i].value);
          const arr2 = [
            ...(Array.isArray(d?.buyOrders) ? d.buyOrders : []),
            ...(Array.isArray(d?.sellOrders) ? d.sellOrders : []),
            ...(Array.isArray(d?.items) ? d.items : []),
            ...(Array.isArray(d?.orders) ? d.orders : [])
          ];
          for (const o of arr2) {
            const price = Number(o.price??o.pricePerUnit??o.unitPrice??o.value??o.amount??0);
            const qty = Number(o.quantity??o.amount??o.count??1);
            commodityOrders.push({ ...o, _itemCode:topItems[i], _price:price, _qty:qty });
          }
        }
      }
    }

    try {
      const txR = await fetchTrpc("transaction.getPaginatedTransactions", { limit:20, transactionType:"itemMarket" }, k);
      const txData = unwrap(txR);
      const txItems = Array.isArray(txData) ? txData : (txData?.items || []);
      equipmentOrders = txItems.map(t => ({
        _itemCode: t.itemCode || t.item || "?",
        _price: Number(t.money??t.unitPrice??t.price??t.amount??0),
        _qty: Number(t.quantity??t.amount??1),
        orderType: t.type || "TRADE",
        side:"—"
      }));
      equipmentOrders.sort((a,b)=>Number(b._price||0)-Number(a._price||0));
    } catch(err){ console.error("equipment orders failed", err); }

    S.market.commodityOrders = commodityOrders;
    S.market.equipmentOrders = equipmentOrders;
    allOrders = S.market.orderView === "equipment" ? equipmentOrders : commodityOrders;
    S.market.orders = allOrders;
    renderMarketOrders();
    clrMs(E.marketOrdersStatus);
  } catch(e){ setMs(E.marketOrdersStatus,"Could not load orders: "+(e.message||""),true); }

  const commodityScores = {};
  for (const o of allOrders) {
    const item = marketItemName(o._itemCode || o.itemCode || o.item);
    const qty = Number(o._qty || o.quantity || o.amount || 0);
    const price = Number(o._price || o.price || 0);
    if(!commodityScores[item]){ commodityScores[item] = { item, qty:0, value:0 }; }
    commodityScores[item].qty += qty;
    commodityScores[item].value += qty * price;
  }

  const topValuable = Object.values(commodityScores).sort((a,b)=>b.value-a.value).slice(0,20);
  S.market.topValuable = topValuable;

  const prevScores = S.market.prevCommodityScores || {};
  for(const item of topValuable){
    const oldValue = prevScores[item.item];
    item.trend = 0;
    item.changePct = 0;
    if(Number.isFinite(oldValue) && oldValue > 0){
      item.changePct = ((item.value - oldValue) / oldValue) * 100;
      if(item.value > oldValue){ item.trend = 1; }
      else if(item.value < oldValue){ item.trend = -1; }
    }
  }

  E.marketValuableData.innerHTML = commodityBars(topValuable);

  S.market.prevCommodityScores = {};
  for(const item of topValuable){ S.market.prevCommodityScores[item.item] = item.value; }

  loadMarketStats();
  if (window.ecgPulse) window.ecgPulse(1.5);
}

export function renderMarketOrders(){
  const data = S.market.orderView === "equipment" ? S.market.equipmentOrders : S.market.commodityOrders;
  E.marketOrdersData.innerHTML = data.slice(0,100).map(o=>{
    const item = marketItemName(o._itemCode||o.itemCode ||o.item ||o.name);
    const qty = o._qty || o.quantity || o.amount || 0;
    const price = o._price;
    const type = (o.orderType || o.type || o.side || "ORDER").toUpperCase();
    return `<div class="price-row">
      <span class="price-name">${item} <small style="color:var(--ink-dim)">${type} ×${fmtNum(qty)}</small></span>
      <span class="price-val">${price>0 ? fmtMoney(price)+" ₿/u" : "—"}</span>
    </div>`;
  }).join("") || "<p style='color:var(--ink-dim)'>No orders available.</p>";
}

export function copyMarketReport() {
  const ec=S.market.econ; const prices=S.market.prices||[]; const orders=S.market.orders||[];
  let r=`# War Era Market Intelligence Report\nGenerated: ${new Date().toUTCString()}\n\n## Economic Overview\n`;
  if(ec){ r+=`- Avg wage: ${fmtMoney(ec.avgWage, 3)} BTC/hit\n- Avg payroll: ${fmtMoney(ec.avgPayroll)} BTC\n- Total payroll: ${fmtMoney(ec.totalPayroll)} BTC\n- Total work done: ${fmtNum(ec.totalQuantity)} hits (${ec.wageCount} txn)\n- Trade vol: ${fmtMoney(ec.tradeVol)} BTC (${ec.tradeCount} txn)\n\n`; }
  r+=`## Top Commodity Prices\n`;
  for(const i of prices.slice(0,23)) r+=`- ${i.itemCode||i.name||"?"}: ${fmtMoney(Number(i.price||0))} BTC\n`;
  r+=`\n## Top Trading Orders\n`;
  for(const o of orders.slice(0,100)) r+=`- ${(o.orderType||o.type||"ORDER")} ${o._itemCode||o.itemCode||"?"} ×${fmtNum(o._qty||o.quantity||0)} @ ${fmtMoney(o._price||0)} BTC/u\n`;
  r += `\n\n## Most Valuable Commodities\n`;
  const commodityScores = {};
  for(const o of orders){
    const item = o._itemCode || o.itemCode || o.item || "?";
    const qty = Number(o._qty || o.quantity || o.amount || 0);
    const price = Number(o._price || o.price || 0);
    if(!commodityScores[item]){ commodityScores[item] = { item, value:0 }; }
    commodityScores[item].value += qty * price;
  }
  const valuable = Object.values(commodityScores).sort((a,b)=>b.value-a.value).slice(0,20);
  const prevScores = S.market.prevCommodityScores || {};
  for(const item of valuable){
    const oldValue = prevScores[item.item];
    let trend = ""; let change = "";
    if(Number.isFinite(oldValue) && oldValue > 0){
      const pct = ((item.value - oldValue) / oldValue) * 100;
      if(pct > 0){ trend = "▲"; change = ` (+${pct.toFixed(1)}%)`; }
      else if(pct < 0){ trend = "▼"; change = ` (${pct.toFixed(1)}%)`; }
    }
    r += `- ${item.item}: ${fmtMoney(item.value)} BTC ${trend}${change}\n`;
  }
  navigator.clipboard.writeText(r).then(()=>toast("Market report copied."));
}

export function captureMarketReport() {
  const ec=S.market.econ; const prices=S.market.prices||[]; const orders=S.market.orders||[];
  const overviewRows = [];
  if(ec) {
    overviewRows.push(["Avg Wage", fmtMoney(ec.avgWage, 3)+" BTC/hit"]);
    overviewRows.push(["Avg Payroll", fmtMoney(ec.avgPayroll)+" BTC"]);
    overviewRows.push(["Total Payroll", fmtMoney(ec.totalPayroll)+" BTC"]);
    overviewRows.push(["Total Work Done", fmtNum(ec.totalQuantity)+" hits ("+ec.wageCount+" txn)"]);
    overviewRows.push(["Trade Volume", fmtMoney(ec.tradeVol)+" BTC ("+ec.tradeCount+" txn)"]);
  }
  const priceRows = prices.slice(0,10).map(i => [marketItemName(i.itemCode||i.name), fmtMoney(Number(i.price||0))+" BTC"]);
  const commodityScores = {};
  for(const o of orders){
    const itemCode = o._itemCode || o.itemCode || o.item || "?";
    const qty = Number(o._qty || o.quantity || o.amount || 0);
    const price = Number(o._price || o.price || 0);
    if(!commodityScores[itemCode]){ commodityScores[itemCode] = { itemCode, value:0 }; }
    commodityScores[itemCode].value += qty * price;
  }
  const valuable = Object.values(commodityScores).sort((a,b)=>b.value-a.value).slice(0,10);
  const valuableRows = valuable.map(entry => [marketItemName(entry.itemCode), fmtMoney(entry.value)+" BTC"]);

  const html = cap.pageOpen("War Era Market Intelligence Report", "", ["Generated: "+new Date().toUTCString()]) +
    (overviewRows.length ? cap.section("Economic Overview", cap.tableBlock("", ["Metric","Value"], overviewRows, 99)) : "") +
    (priceRows.length ? cap.section("Top Commodity Prices", cap.tableBlock("", ["#","Item","Price"], priceRows.map((r,i)=>[String(i+1),...r]), 10)) : "") +
    (valuableRows.length ? cap.section("Most Valuable Commodities", cap.tableBlock("", ["#","Item","Value"], valuableRows.map((r,i)=>[String(i+1),...r]), 10)) : "") +
    cap.pageClose();
  cap.captureHTML(html, "market_report_"+cap.ts()+".png");
}
