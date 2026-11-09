(() => {
  "use strict";
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }, { once: true });
  }
  const $ = (selector, root = document) => root.querySelector(selector);
  const money = (paise) => paise == null ? "—" : new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:2 }).format(Number(paise)/100);
  const navMoney = (value) => value == null ? "—" : new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:4 }).format(Number(value));
  const percent = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : (Number(value)*100).toFixed(2)+"%";
  const dateLabel = (value) => {
    if (!value) return "—";
    const date = new Date(value+"T00:00:00Z");
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(date);
  };
  const node = (tag, className, value) => { const item=document.createElement(tag); if(className)item.className=className; if(value!==undefined)item.textContent=value; return item; };
  const addMetric = (host,label,value) => { const item=node("div","demo-metric"); item.append(node("span","",label),node("strong","",value)); host.append(item); };
  const stockStatusLabel = (status) => ({ready:"Yahoo daily feed",disabled:"Free feed",not_configured:"Free feed",unavailable:"Feed unavailable"}[status] || "Checking");
  const showError = (message) => ["#demo-overview","#demo-stocks","#demo-funds"].forEach((selector) => {
    const host=$(selector); if(host){host.replaceChildren();host.append(node("p","demo-error",message));}
  });
  const renderStocks = (data) => {
    const host=$("#demo-stocks"); if(!host)return; host.replaceChildren();
    const heading=node("div","demo-card-heading");
    heading.append(node("div","demo-card-title","Static sample stock lots"),node("span","demo-badge",data.stockDataStatus==="ready"?"YAHOO DAILY":"DEMO INPUTS"));
    host.append(heading);
    if(data.stocks.length){
      data.stocks.forEach((stock)=>{
        const row=node("article","demo-holding-row"),left=node("div","demo-holding-main"),right=node("div","demo-holding-value");
        left.append(node("strong","",stock.name),node("small","",stock.quantity.toFixed(2)+" share-equivalent units · bought "+dateLabel(stock.purchaseDate)));
        right.append(node("strong","",money(stock.marketValuePaise)),node("small","",navMoney(stock.latestPrice)+" · "+dateLabel(stock.latestPriceDate)));
        row.append(left,right);
        const detail=node("div","demo-holding-detail");
        detail.append(node("span","","Cost "+money(stock.investedPaise)),node("span","","Price return "+percent(stock.absoluteReturn)),node("span","","Cash dividends excluded"));
        row.append(detail); host.append(row);
      });
    }else{
      data.sampleStockLots.forEach((stock)=>{
        const row=node("article","demo-holding-row"),left=node("div","demo-holding-main"),right=node("div","demo-holding-value");
        left.append(node("strong","",stock.name),node("small","",stock.quantity.toFixed(2)+" demo share-equivalent units · from "+dateLabel(stock.purchaseDate)));
        right.append(node("strong","","—"),node("small","","Awaiting real price data"));
        row.append(left,right); host.append(row);
      });
      host.append(node("p","demo-error",data.stockDataMessage));
    }
    host.append(node("p","demo-source-copy","Yahoo Finance daily history (unofficial). Close values are split-adjusted; cash dividends are excluded. The free source may be delayed or unavailable."));
  };
  const renderFunds = (data) => {
    const host=$("#demo-funds"); if(!host)return; host.replaceChildren();
    const heading=node("div","demo-card-heading");
    heading.append(node("div","demo-card-title","Static sample SIPs"),node("span","demo-badge","REAL NAV")); host.append(heading);
    data.funds.forEach((fund)=>{
      const row=node("article","demo-holding-row"),left=node("div","demo-holding-main"),right=node("div","demo-holding-value");
      left.append(node("strong","",fund.schemeName),node("small","",money(fund.monthlyAmountPaise)+"/month · since "+dateLabel(fund.startDate)));
      right.append(node("strong","",money(fund.currentValuePaise)),node("small","",navMoney(fund.latestNav)+" NAV · "+dateLabel(fund.latestNavDate)));
      row.append(left,right);
      const detail=node("div","demo-holding-detail");
      detail.append(node("span","",fund.units.toFixed(4)+" units"),node("span","",fund.pricedInstallmentCount+" priced · "+fund.missedCount+" missed"),
        node("span","demo-return "+(fund.profitLossPaise>=0?"is-positive":"is-negative"),(fund.profitLossPaise>=0?"+":"")+money(fund.profitLossPaise)+" · "+percent(fund.absoluteReturn)));
      row.append(detail); host.append(row);
    });
    host.append(node("p","demo-source-copy",data.providers.mutualFunds+". NAVs are daily fund disclosures, not intraday prices."));
  };
  const render = (data) => {
    const title=$("#portfolio-title"),note=$("#portfolio-note"),asof=$("#portfolio-asof");
    if(title&&!document.body.dataset.wealthSelection)title.textContent="Sample portfolio";
    if(asof)asof.textContent=(data.valuationComplete?"Market data ":"NAV data ")+dateLabel(data.asOfDate);
    if(!document.body.dataset.wealthSelection){
      $("#portfolio-value").textContent=money(data.currentValuePaise);
      $("#portfolio-invested").textContent=money(data.investedPaise);
      $("#portfolio-profit").textContent=money(data.profitLossPaise);
      $("#portfolio-xirr").textContent=percent(data.xirr);
      const ret=$("#portfolio-return");
      ret.textContent=data.valuationComplete
        ? (data.profitLossPaise>=0?"+":"")+money(data.profitLossPaise)+" ("+percent(data.absoluteReturn)+") · stock cash dividends excluded"
        : "Partial preview: real fund NAVs are loaded. Stock values remain blank if the free Yahoo Finance source is unavailable.";
      ret.classList.toggle("positive",data.valuationComplete&&data.profitLossPaise>0);
      ret.classList.toggle("negative",data.valuationComplete&&data.profitLossPaise<0);
    }
    if(note)note.textContent=data.sampleDataNotice;
    const status=$("#stock-feed-status"); if(status)status.textContent=stockStatusLabel(data.stockDataStatus);
    const overview=$("#demo-overview");
    if(overview){
      overview.replaceChildren();
      const heading=node("div","demo-card-heading");
      heading.append(node("div","demo-card-title","Your sample holdings"),node("span","demo-badge","STATIC DEMO")); overview.append(heading);
      const metrics=node("div","demo-metrics");
      addMetric(metrics,"Stocks",data.valuationComplete?money(data.stocks.reduce((s,x)=>s+x.marketValuePaise,0)):"Awaiting free stock feed");
      addMetric(metrics,"Mutual funds",money(data.fundsCurrentValuePaise));
      addMetric(metrics,"Stock feed",stockStatusLabel(data.stockDataStatus));
      overview.append(metrics,node("p","demo-source-copy","Fund NAVs: MFapi.in · Stock candles: Yahoo Finance (unofficial) · Common date: "+dateLabel(data.asOfDate)));
      const links=node("div","demo-links");
      const stocksLink=node("button","demo-jump","View sample stocks →"); stocksLink.type="button";
      stocksLink.addEventListener("click",()=>document.querySelector('[data-tab="stocks"]')?.click());
      const fundsLink=node("button","demo-jump","View sample funds →"); fundsLink.type="button";
      fundsLink.addEventListener("click",()=>document.querySelector('[data-tab="funds"]')?.click());
      links.append(stocksLink,fundsLink); overview.append(links);
    }
    renderStocks(data); renderFunds(data);
  };
  const initialize=async()=>{
    try{
      const response=await fetch("/api/wealth/demo",{credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json"}});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.ok!==true)throw new Error(payload.message||"Live market data is unavailable.");
      render(payload);
    }catch(error){showError((error&&error.message)||"Market data is unavailable. No sample prices are substituted.");}
  };
  document.addEventListener("DOMContentLoaded",initialize,{once:true});
})();