(() => {
  "use strict";
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
  const showError = (message) => ["#demo-overview","#demo-stocks","#demo-funds"].forEach((selector) => {
    const host=$(selector); if(host){host.replaceChildren();host.append(node("p","demo-error",message));}
  });
  const render = (data) => {
    const title=$("#portfolio-title"), note=$("#portfolio-note"), asof=$("#portfolio-asof");
    if(title&&!document.body.dataset.wealthSelection)title.textContent="Sample portfolio";
    if(asof)asof.textContent="Market data "+dateLabel(data.asOfDate);
    if(!document.body.dataset.wealthSelection){
      $("#portfolio-value").textContent=money(data.currentValuePaise);
      $("#portfolio-invested").textContent=money(data.investedPaise);
      $("#portfolio-profit").textContent=money(data.profitLossPaise);
      $("#portfolio-xirr").textContent=percent(data.xirr);
      const ret=$("#portfolio-return");
      ret.textContent=(data.profitLossPaise>=0?"+":"")+money(data.profitLossPaise)+" ("+percent(data.absoluteReturn)+") · includes dividends";
      ret.classList.toggle("positive",data.profitLossPaise>0); ret.classList.toggle("negative",data.profitLossPaise<0);
    }
    if(note)note.textContent=data.sampleDataNotice;
    const overview=$("#demo-overview");
    if(overview){
      overview.replaceChildren();
      const heading=node("div","demo-card-heading");
      heading.append(node("div","demo-card-title","Your sample holdings"),node("span","demo-badge","STATIC DEMO"));
      overview.append(heading);
      const metrics=node("div","demo-metrics");
      addMetric(metrics,"Stocks",money(data.stocks.reduce((s,x)=>s+x.marketValuePaise,0)));
      addMetric(metrics,"Mutual funds",money(data.funds.reduce((s,x)=>s+x.currentValuePaise,0)));
      addMetric(metrics,"Dividends received",money(data.stocks.reduce((s,x)=>s+x.dividendsPaise,0)));
      overview.append(metrics,node("p","demo-source-copy","Stock closes: Yahoo Finance · Fund NAV: MFapi.in · Common date: "+dateLabel(data.asOfDate)));
      const links=node("div","demo-links");
      const stocksLink=node("button","demo-jump","View sample stocks →"); stocksLink.type="button";
      stocksLink.addEventListener("click",()=>document.querySelector('[data-tab="stocks"]')?.click());
      const fundsLink=node("button","demo-jump","View sample funds →"); fundsLink.type="button";
      fundsLink.addEventListener("click",()=>document.querySelector('[data-tab="funds"]')?.click());
      links.append(stocksLink,fundsLink); overview.append(links);
    }
    const stocksHost=$("#demo-stocks");
    if(stocksHost){
      stocksHost.replaceChildren();
      const heading=node("div","demo-card-heading");
      heading.append(node("div","demo-card-title","Static sample stock lots"),node("span","demo-badge","REAL DAILY CLOSES")); stocksHost.append(heading);
      data.stocks.forEach((stock)=>{
        const row=node("article","demo-holding-row"),left=node("div","demo-holding-main"),right=node("div","demo-holding-value");
        left.append(node("strong","",stock.name),node("small","",stock.quantity.toFixed(2)+" shares · bought "+dateLabel(stock.purchaseDate)));
        right.append(node("strong","",money(stock.marketValuePaise)),node("small","",navMoney(stock.latestPrice)+" · "+dateLabel(stock.latestPriceDate)));
        row.append(left,right);
        const detail=node("div","demo-holding-detail");
        detail.append(node("span","","Cost "+money(stock.investedPaise)),node("span","","Dividends "+money(stock.dividendsPaise)),
          node("span","demo-return "+(stock.profitLossPaise>=0?"is-positive":"is-negative"),(stock.profitLossPaise>=0?"+":"")+money(stock.profitLossPaise)+" · "+percent(stock.absoluteReturn)));
        row.append(detail); stocksHost.append(row);
      });
      stocksHost.append(node("p","demo-source-copy",data.providers.stocks+". Sample quantities and buy dates are fixed; price data is not."));
    }
    const fundsHost=$("#demo-funds");
    if(fundsHost){
      fundsHost.replaceChildren();
      const heading=node("div","demo-card-heading");
      heading.append(node("div","demo-card-title","Static sample SIPs"),node("span","demo-badge","REAL NAV")); fundsHost.append(heading);
      data.funds.forEach((fund)=>{
        const row=node("article","demo-holding-row"),left=node("div","demo-holding-main"),right=node("div","demo-holding-value");
        left.append(node("strong","",fund.schemeName),node("small","",money(fund.monthlyAmountPaise)+"/month · since "+dateLabel(fund.startDate)));
        right.append(node("strong","",money(fund.currentValuePaise)),node("small","",navMoney(fund.latestNav)+" NAV · "+dateLabel(fund.latestNavDate)));
        row.append(left,right);
        const detail=node("div","demo-holding-detail");
        detail.append(node("span","",fund.units.toFixed(4)+" units"),node("span","",fund.pricedInstallmentCount+" priced · "+fund.missedCount+" missed"),
          node("span","demo-return "+(fund.profitLossPaise>=0?"is-positive":"is-negative"),(fund.profitLossPaise>=0?"+":"")+money(fund.profitLossPaise)+" · "+percent(fund.absoluteReturn)));
        row.append(detail); fundsHost.append(row);
      });
      fundsHost.append(node("p","demo-source-copy",data.providers.mutualFunds+". Daily NAV disclosures, not intraday prices."));
    }
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