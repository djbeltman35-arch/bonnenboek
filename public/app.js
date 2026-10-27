(() => {
"use strict";

/* ================= constants ================= */
const CATS = ["Groente & fruit","Zuivel & eieren","Vlees & vis","Vega & alternatieven","Brood & bakkerij","Droge waren","Diepvries","Dranken","Snacks & snoep","Ontbijt & beleg","Verzorging","Huishouden","Baby & kind","Dier","Statiegeld","Korting","Overig"];
const CAT_COLOR = i => `var(--c${(i % 8) + 1})`;
const STORE_COLORS = {"albert heijn":"#00A0E2","ah":"#00A0E2","jumbo":"#C9A100","lidl":"#0050AA","aldi":"#1B2A6B","plus":"#66A51B","dirk":"#D7141A","dekamarkt":"#E30613","coop":"#F47920","spar":"#00843D","vomar":"#E2001A","hoogvliet":"#0072BC","ekoplaza":"#7AB800","picnic":"#E1171E","colruyt":"#E2001A","delhaize":"#C8102E","kruidvat":"#E4007C","etos":"#00609C","action":"#003A70","rewe":"#CC071E","edeka":"#C9A100","poiesz":"#E2001A","nettorama":"#F39200"};
const MONTHS = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
const LS = "bonnenboek.v1";
const POLL_MS = 15000;

/* ================= state ================= */
const st = {
  code: null, hhNaam: "", mijnNaam: "",
  bonnen: {},          // id -> bon (incl. etag)
  budgetCent: null, regels: [], rekeningen: {}, pushOn: false,
  queue: [],           // pending writes: {t:"put",id} | {t:"del",id} | {t:"budget",c}
  view: "overzicht", ym: ym(new Date()), query: "", person: "", rankPeriod: "maand", rankSort: "bedrag",
  sync: "idle",        // idle | busy | ok | off | error
  lastSync: null,
};
let installEvt = null;

/* ================= helpers ================= */
function ym(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0") }
function today(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0") }
function shiftYm(s,n){ const [y,m]=s.split("-").map(Number); return ym(new Date(y,m-1+n,1)) }
function ymLabel(s,short){ const [y,m]=s.split("-").map(Number); return short?MONTHS[m-1].slice(0,3):MONTHS[m-1]+" "+y }
const fmt = new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"});
const eur = c => fmt.format((c||0)/100);
const eurShort = c => "€" + Math.round((c||0)/100).toLocaleString("nl-NL");
function parseEur(v){ if(typeof v==="number") return Math.round(v*100); if(!v) return 0;
  let s=String(v).replace(/[€\s]/g,""); if(/,\d{1,2}$/.test(s)) s=s.replace(/\./g,"").replace(",","."); else s=s.replace(/,/g,"");
  const n=parseFloat(s); return isNaN(n)?0:Math.round(n*100) }
const centToInput = c => ((c||0)/100).toFixed(2).replace(".",",");
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])) }
function dayLabel(iso){ if(!iso) return "Zonder datum"; if(iso===today()) return "Vandaag";
  const y=new Date(); y.setDate(y.getDate()-1); if(iso===ym(y)+"-"+String(y.getDate()).padStart(2,"0")) return "Gisteren";
  return new Date(iso+"T12:00:00").toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long"}) }
function storeColor(n){ const k=(n||"").toLowerCase().trim(); for(const key in STORE_COLORS){ if(k===key||k.startsWith(key+" ")||k.startsWith(key)) return STORE_COLORS[key] }
  let h=0; for(const ch of k) h=(h*31+ch.charCodeAt(0))%360; return `hsl(${h} 38% 42%)` }
function initials(n){ const w=(n||"?").replace(/[^\p{L}\p{N} ]/gu,"").trim().split(/\s+/); return ((w[0]||"?")[0]+(w[1]?w[1][0]:(w[0]||"")[1]||"")).toUpperCase() }
function toast(msg){ const r=document.getElementById("toastRoot"); r.innerHTML=`<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t=setTimeout(()=>r.innerHTML="",2800) }
const sumItems = items => (items||[]).reduce((a,i)=>a+(i.cent||0),0);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,12)));
const $ = id => document.getElementById(id);

/* ================= persistence ================= */
function load(){ try{ const j=JSON.parse(localStorage.getItem(LS)||"null"); if(j) Object.assign(st,{code:j.code||null,hhNaam:j.hhNaam||"",mijnNaam:j.mijnNaam||"",bonnen:j.bonnen||{},budgetCent:j.budgetCent??null,regels:j.regels||[],rekeningen:j.rekeningen||{},pushOn:!!j.pushOn,queue:j.queue||[],lastSync:j.lastSync||null}) }catch(e){} }
function save(){ try{ localStorage.setItem(LS,JSON.stringify({code:st.code,hhNaam:st.hhNaam,mijnNaam:st.mijnNaam,bonnen:st.bonnen,budgetCent:st.budgetCent,regels:st.regels,rekeningen:st.rekeningen,pushOn:st.pushOn,queue:st.queue,lastSync:st.lastSync})) }catch(e){} }

/* ================= api ================= */
async function api(method, path, body, timeoutMs=20000){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const res=await fetch(path,{method,signal:ctl.signal,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
    const data=await res.json().catch(()=>({}));
    if(!res.ok){ const e=new Error(data.fout||("Fout "+res.status)); e.status=res.status; throw e }
    return data;
  } catch(e){ if(e.name==="AbortError"){ const x=new Error("Geen verbinding met de server."); x.status=0; throw x } throw e }
  finally{ clearTimeout(t) }
}

/* ================= sync ================= */
let syncing=false, syncAgain=false;
async function flushQueue(){
  while(st.queue.length){
    const op=st.queue[0];
    if(op.t==="put"){ const b=st.bonnen[op.id]; if(b){ const {etag}=await api("PUT","/api/bonnen",{code:st.code,bon:strip(b)}); b.etag=etag; delete b._pend } }
    else if(op.t==="del"){ await api("DELETE",`/api/bonnen?code=${encodeURIComponent(st.code)}&id=${encodeURIComponent(op.id)}`) }
    else if(op.t==="budget"){ await api("PATCH","/api/bonnen",{code:st.code,budgetCent:op.c}) }
    else if(op.t==="inst"){ await api("PATCH","/api/bonnen",{code:st.code,instellingen:op.patch}) }
    st.queue.shift(); save();
  }
}
function strip(b){ const {etag,_pend,...rest}=b; return rest }
async function sync(){
  if(!st.code) return;
  if(syncing){ syncAgain=true; return }
  syncing=true; setSync("busy");
  try{
    await flushQueue();
    const r=await api("GET",`/api/bonnen?code=${encodeURIComponent(st.code)}`);
    st.hhNaam=r.naam||st.hhNaam;
    if(!st.queue.some(o=>o.t==="budget")) st.budgetCent=r.budgetCent;
    if(!st.queue.some(o=>o.t==="inst")){ st.regels=r.regels||[]; st.rekeningen=r.rekeningen||{} }
    const serverIds=new Set(r.index.map(x=>x.id));
    const pendingIds=new Set(st.queue.filter(o=>o.t==="put").map(o=>o.id));
    for(const id of Object.keys(st.bonnen)) if(!serverIds.has(id)&&!pendingIds.has(id)) delete st.bonnen[id];
    const need=r.index.filter(x=>!pendingIds.has(x.id)&&st.bonnen[x.id]?.etag!==x.etag).map(x=>x.id);
    for(let i=0;i<need.length;i+=100){
      const {bonnen}=await api("POST","/api/bonnen",{code:st.code,ids:need.slice(i,i+100)},30000);
      for(const b of bonnen) st.bonnen[b.id]=b;
    }
    st.lastSync=new Date().toISOString(); save(); setSync("ok"); render();
  }catch(e){
    if(e.status===404){ setSync("error"); render(); toast("Deze huishoudcode bestaat niet meer.") }
    else setSync(navigator.onLine?"error":"off");
  }finally{
    syncing=false; if(syncAgain){ syncAgain=false; setTimeout(sync,50) }
  }
}
function setSync(s){ st.sync=s; const d=$("syncDot"); if(!d) return;
  d.className="dot "+({ok:"ok",busy:"busy",off:"off",error:"off"}[s]||"");
  d.title={ok:"Bijgewerkt",busy:"Bezig met bijwerken",off:"Offline: wijzigingen worden later verstuurd",error:"Bijwerken mislukt"}[s]||"" }
setInterval(()=>{ if(document.visibilityState==="visible") sync() },POLL_MS);
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") sync() });
addEventListener("online",sync);
addEventListener("offline",()=>setSync("off"));

/* ================= mutations (optimistic) ================= */
function putBon(b){
  const clean={...b, items:(b.items||[]).filter(i=>i.naam||i.cent).map(i=>({naam:String(i.naam||"").slice(0,120),aantal:Number(i.aantal)||1,cent:i.cent|0,cat:CATS.includes(i.cat)?i.cat:"Overig"}))};
  delete clean._warn;
  clean.id=clean.id||uid(); clean.door=clean.door||st.mijnNaam||""; clean.betaaldDoor=(clean.betaaldDoor||clean.door||"").trim(); clean.gekochtDoor=(clean.gekochtDoor||clean.door||"").trim(); clean.aangemaakt=clean.aangemaakt||new Date().toISOString();
  clean._pend=true; st.bonnen[clean.id]=clean;
  st.queue=st.queue.filter(o=>!(o.t==="put"&&o.id===clean.id)); st.queue.push({t:"put",id:clean.id});
  save(); render(); sync(); return clean;
}
function delBon(id){ delete st.bonnen[id]; st.queue=st.queue.filter(o=>o.id!==id); st.queue.push({t:"del",id}); save(); render(); sync() }
function setInst(patch){
  if(patch.regels) st.regels=patch.regels;
  if(patch.rekeningen) st.rekeningen={...st.rekeningen,...patch.rekeningen};
  st.queue.push({t:"inst",patch}); save(); render(); sync() }
function setBudget(c){ st.budgetCent=c; st.queue=st.queue.filter(o=>o.t!=="budget"); st.queue.push({t:"budget",c}); save(); render(); sync() }

/* ================= data views ================= */
const all = () => Object.values(st.bonnen);
const monthBonnen = (m=st.ym) => all().filter(r=>(r.datum||"").startsWith(m));
const monthTotal = m => monthBonnen(m).reduce((a,r)=>a+(r.totaalCent||0),0);
function byCategory(list){ const map={}; for(const r of list){ const items=r.items||[];
    for(const i of items) map[i.cat||"Overig"]=(map[i.cat||"Overig"]||0)+(i.cent||0);
    const rest=(r.totaalCent||0)-sumItems(items); if(rest) map["Niet ingedeeld"]=(map["Niet ingedeeld"]||0)+rest }
  return Object.entries(map).filter(([,v])=>v!==0).sort((a,b)=>b[1]-a[1]) }
function byStore(list){ const map={}; for(const r of list){ const k=r.winkel||"Onbekend"; map[k]=map[k]||{c:0,n:0}; map[k].c+=r.totaalCent||0; map[k].n++ } return Object.entries(map).sort((a,b)=>b[1].c-a[1].c) }
const payer = r => String(r.betaaldDoor||r.door||"").trim()||"Onbekend";
const buyer = r => String(r.gekochtDoor||r.door||"").trim()||"Onbekend";
const prodCount = r => (r.items||[]).filter(i=>i.cat!=="Korting"&&i.cat!=="Statiegeld").reduce((a,i)=>a+(Number(i.aantal)||1),0);
function rankCard(){
  const per=st.rankPeriod, by=st.rankSort, y=st.ym.slice(0,4);
  const list=all().filter(r=>per==="maand"?(r.datum||"").startsWith(st.ym):per==="jaar"?(r.datum||"").startsWith(y):true);
  const map={}; for(const r of list){ const k=buyer(r); const o=map[k]=map[k]||{c:0,n:0,p:0}; o.c+=r.totaalCent||0; o.n++; o.p+=prodCount(r) }
  const key={bedrag:"c",producten:"p",keer:"n"}[by]; const rows=Object.entries(map).sort((a,b)=>b[1][key]-a[1][key]||b[1].c-a[1].c);
  const perLabel={maand:ymLabel(st.ym),jaar:y,alles:"altijd"}[per];
  const opt=(v,l,cur)=>`<option value="${v}"${cur===v?" selected":""}>${l}</option>`;
  const val=o=>by==="producten"?`${o.p} product${o.p===1?"":"en"}`:by==="keer"?`${o.n}× boodschappen`:eur(o.c);
  const sub=o=>by==="bedrag"?`${o.n}× boodschappen · ${o.p} producten`:by==="producten"?`${o.n}× boodschappen · ${eur(o.c)}`:`${o.p} producten · ${eur(o.c)}`;
  return `<section class="card" id="ranglijst"><div class="sechead"><h3>Ranglijst boodschappen doen</h3><span class="lbl">${esc(perLabel)}</span></div>
    <div class="selects">
      <label class="field"><span class="lbl">Periode</span><select id="rankPeriod">${opt("maand","Deze maand",per)}${opt("jaar","Dit jaar",per)}${opt("alles","Altijd",per)}</select></label>
      <label class="field"><span class="lbl">Rangschikken op</span><select id="rankSort">${opt("bedrag","Bedrag",by)}${opt("producten","Aantal producten",by)}${opt("keer","Aantal keer",by)}</select></label>
    </div>
    ${rows.length?`<ol class="rank">${rows.map(([n,o],i)=>`<li class="${i<3&&rows.length>1?"top top"+(i+1):""}"><span class="pos">${i+1}</span>
      <span class="avatar" style="background:${n==="Onbekend"?"var(--muted)":personColor(n)}">${esc(initials(n))}</span>
      <span class="pinfo"><span class="pname">${esc(n)}${isMe(n)?' <span class="tag">jij</span>':""}</span><span class="psub">${sub(o)}</span></span>
      <span class="amt">${val(o)}</span></li>`).join("")}</ol>`:`<p class="note">Nog geen bonnen in deze periode.</p>`}
  </section>` }
const isMe = n => !!st.mijnNaam && n.toLowerCase()===st.mijnNaam.toLowerCase();
function knownPeople(){ const set=new Map(); const add=n=>{ n=String(n||"").trim(); if(n&&!set.has(n.toLowerCase())) set.set(n.toLowerCase(),n) };
  add(st.mijnNaam); for(const r of all()){ add(r.betaaldDoor); add(r.door) } return [...set.values()] }
function byPerson(list){ const map={}; for(const r of list){ const k=payer(r); map[k]=map[k]||{c:0,n:0}; map[k].c+=r.totaalCent||0; map[k].n++ }
  return Object.entries(map).sort((a,b)=>b[1].c-a[1].c) }
function personColor(n){ let h=0; for(const ch of n.toLowerCase()) h=(h*37+ch.charCodeAt(0))%8; return `var(--c${h+1})` }
/* ---------- betaalverzoeken ---------- */
const same=(a,b)=>String(a||"").trim().toLowerCase()===String(b||"").trim().toLowerCase();
function verzoeken(){ const out=[];
  for(const r of all()) for(const g of st.regels){
    if(!same(buyer(r),g.van)||(r.aangemaakt||"")<g.sinds) continue;
    out.push({bon:r,van:g.van,aan:g.aan,cent:Math.round((r.totaalCent||0)*g.pct/100),betaald:!!r.verrekend}) }
  return out.sort((a,b)=>sortRec(a.bon,b.bon)) }
function pairs(list){ const m=new Map(); for(const v of list){ const k=v.van.toLowerCase()+"→"+v.aan.toLowerCase(); if(!m.has(k)) m.set(k,{van:v.van,aan:v.aan,items:[]}); m.get(k).items.push(v) } return [...m.values()] }
function requestBanner(){
  if(!st.mijnNaam||!st.regels.length) return "";
  const open=verzoeken().filter(v=>!v.betaald); let html="";
  for(const p of pairs(open)){ const tot=p.items.reduce((a,v)=>a+v.cent,0);
    if(same(p.aan,st.mijnNaam)) html+=`<button class="reqbanner pay" data-act="verzoeken"><span class="lbl">Betaalverzoek</span><span>Je moet <b>${esc(p.van)}</b> nog <b class="num">${eur(tot)}</b> betalen</span><span class="note">${p.items.length} bon${p.items.length===1?"":"nen"} · tik om te betalen</span></button>`;
    else if(same(p.van,st.mijnNaam)) html+=`<button class="reqbanner" data-act="verzoeken"><span class="lbl">Openstaand</span><span><b>${esc(p.aan)}</b> moet je nog <b class="num">${eur(tot)}</b> betalen</span><span class="note">${p.items.length} bon${p.items.length===1?"":"nen"}</span></button>` }
  return html }
function ibanOk(i){ i=String(i||"").replace(/\s+/g,"").toUpperCase(); if(!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  const r=(i.slice(4)+i.slice(0,4)).replace(/[A-Z]/g,c=>c.charCodeAt(0)-55); let m=0; for(const ch of r) m=(m*10+ +ch)%97; return m===1 }
const fmtIban = i => String(i||"").replace(/\s+/g,"").replace(/(.{4})/g,"$1 ").trim();
function verzoekenSheet(){
  const all_=verzoeken(); const open=all_.filter(v=>!v.betaald); const done=all_.filter(v=>v.betaald).slice(0,8);
  const groups=pairs(open);
  const body=groups.map((p,gi)=>{ const tot=p.items.reduce((a,v)=>a+v.cent,0); const rek=Object.entries(st.rekeningen).find(([n])=>same(n,p.van))?.[1];
    const oms=`Boodschappen ${p.items.length===1?p.items[0].bon.winkel+" "+p.items[0].bon.datum.split("-").reverse().join("-"):p.items.length+" bonnen"}`;
    const iPay=same(p.aan,st.mijnNaam);
    return `<section class="reqgroup">
      <div class="sechead"><h3>${esc(p.aan)} betaalt ${esc(p.van)}</h3><b class="num">${eur(tot)}</b></div>
      <div class="detail-items">${p.items.map(v=>`<div class="r"><span>${esc(v.bon.winkel)}<small>${esc(dayLabel(v.bon.datum))}${v.cent!==v.bon.totaalCent?` · ${Math.round(v.cent/v.bon.totaalCent*100)}% van ${eur(v.bon.totaalCent)}`:""}</small></span><span style="display:flex;gap:10px;align-items:center"><span class="num">${eur(v.cent)}</span><button class="btn ghost small" data-paid="${esc(v.bon.id)}">Betaald</button></span></div>`).join("")}</div>
      ${iPay?(rek&&rek.iban?`<div class="paybox">
        <div class="payrow"><span class="lbl">Bedrag</span><b class="num">${eur(tot)}</b><button class="linkbtn" data-copy="${centToInput(tot)}">kopieer</button></div>
        <div class="payrow"><span class="lbl">IBAN</span><b class="mono">${esc(fmtIban(rek.iban))}</b><button class="linkbtn" data-copy="${esc(rek.iban)}">kopieer</button></div>
        <div class="payrow"><span class="lbl">T.n.v.</span><b>${esc(rek.tnv||p.van)}</b></div>
        <div class="payrow"><span class="lbl">Omschrijving</span><b>${esc(oms)}</b><button class="linkbtn" data-copy="${esc(oms)}">kopieer</button></div>
        <p class="note">Open je bankapp, maak het bedrag over en tik daarna op <b>Alles betaald</b>.</p></div>`
        :`<p class="note">Er is nog geen rekeningnummer van ${esc(p.van)}.</p><button class="btn ghost" data-act2="regels">Rekeningnummer invullen</button>`)
        :`<p class="note">${esc(p.aan)} krijgt een melding en ziet dit bedrag als betaalverzoek.</p>`}
      <button class="btn primary" data-paidall="${gi}">Alles betaald${iPay?"":" (ontvangen)"}</button>
    </section>` }).join("");
  openSheet(`${head("Betaalverzoeken")}
    ${groups.length?body:`<div class="empty"><h3>Alles is verrekend</h3><p>Er staan geen betaalverzoeken open.</p></div>`}
    ${done.length?`<span class="lbl">Laatst verrekend</span><div class="detail-items">${done.map(v=>`<div class="r"><span>${esc(v.bon.winkel)} · ${esc(v.aan)} &gt; ${esc(v.van)}<small>betaald ${esc(new Date(v.bon.verrekend.op).toLocaleDateString("nl-NL",{day:"numeric",month:"short"}))}</small></span><span style="display:flex;gap:10px;align-items:center"><span class="num">${eur(v.cent)}</span><button class="linkbtn" data-undo="${esc(v.bon.id)}">ongedaan</button></span></div>`).join("")}</div>`:""}
    ${!st.regels.length?`<p class="note">Er zijn nog geen betaalregels. Stel ze in bij de naam van het huishouden &gt; Betaalverzoeken.</p>`:""}`,
  sh=>{ const mark=(ids,val)=>{ for(const id of ids){ const b=st.bonnen[id]; if(!b) continue; putBon({...JSON.parse(JSON.stringify(b)),verrekend:val?{op:new Date().toISOString(),door:st.mijnNaam}:null}) } };
    sh.querySelectorAll("[data-paid]").forEach(b=>b.onclick=()=>{ mark([b.dataset.paid],true); toast("Op betaald gezet"); verzoekenSheet() });
    sh.querySelectorAll("[data-undo]").forEach(b=>b.onclick=()=>{ mark([b.dataset.undo],false); verzoekenSheet() });
    sh.querySelectorAll("[data-paidall]").forEach(b=>b.onclick=()=>{ const g=groups[+b.dataset.paidall]; mark(g.items.map(v=>v.bon.id),true); toast(`${eur(g.items.reduce((a,v)=>a+v.cent,0))} verrekend`); verzoekenSheet() });
    sh.querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>copy(b.dataset.copy,"Gekopieerd"));
    sh.querySelectorAll('[data-act2="regels"]').forEach(b=>b.onclick=regelsSheet) });
}
function regelsSheet(){
  const ppl=knownPeople(); for(const g of st.regels){ if(!ppl.some(n=>same(n,g.van))) ppl.push(g.van); if(!ppl.some(n=>same(n,g.aan))) ppl.push(g.aan) }
  const rekVan=n=>Object.entries(st.rekeningen).find(([k])=>same(k,n))?.[1];
  const defWho=(st.regels.find(g=>!rekVan(g.van))||{}).van||st.mijnNaam||""; const cur=rekVan(defWho);
  const pushSupported="Notification" in window&&"PushManager" in window&&"serviceWorker" in navigator;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  openSheet(`${head("Betaalverzoeken")}
    <p class="note">Leg vast wie wiens boodschappen terugbetaalt. Elke nieuwe bon van die persoon wordt dan automatisch een betaalverzoek.</p>
    <div class="detail-items">${st.regels.map((g,i)=>`<div class="r"><span>Bonnen van <b>${esc(g.van)}</b> worden betaald door <b>${esc(g.aan)}</b><small>${g.pct}% van het bedrag · vanaf ${esc(new Date(g.sinds).toLocaleDateString("nl-NL",{day:"numeric",month:"long"}))}</small></span><button class="linkbtn" data-rm="${i}" style="color:var(--bad)">verwijder</button></div>`).join("")||'<p class="note">Nog geen regels.</p>'}</div>
    <datalist id="pplList">${ppl.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="grid2">
      <label class="field"><span class="lbl">Bonnen van</span><input id="rVan" list="pplList" placeholder="Bijv. Hilde"></label>
      <label class="field"><span class="lbl">Betaald door</span><input id="rAan" list="pplList" placeholder="Bijv. Erik"></label>
      <label class="field"><span class="lbl">Percentage</span><input id="rPct" inputmode="numeric" value="100"></label>
      <div class="field" style="justify-content:flex-end"><button class="btn ghost" data-add>Regel toevoegen</button></div>
    </div>
    <p class="note">Gebruik precies dezelfde naam als de persoon in de app heeft ingesteld.</p>
    <span class="lbl" style="margin-top:6px">Rekeningnummers om terugbetaald te worden</span>
    ${Object.keys(st.rekeningen).filter(n=>st.rekeningen[n].iban).length?`<div class="detail-items">${Object.entries(st.rekeningen).filter(([,r])=>r.iban).map(([n,r])=>`<div class="r"><span><b>${esc(n)}</b><small class="mono">${esc(fmtIban(r.iban))} · t.n.v. ${esc(r.tnv||n)}</small></span><button class="linkbtn" data-editrek="${esc(n)}">wijzig</button></div>`).join("")}</div>`:`<p class="note">Nog geen rekeningnummers. Vul het rekeningnummer in van degene die het geld terugkrijgt.</p>`}
    <div class="grid2">
      <label class="field"><span class="lbl">Rekening van</span><input id="kWie" list="pplList" value="${esc(defWho)}" placeholder="Bijv. Hilde"></label>
      <label class="field"><span class="lbl">IBAN</span><input id="kIban" class="mono" autocapitalize="characters" value="${esc(fmtIban(cur?.iban||""))}" placeholder="NL00 BANK 0123 4567 89"></label>
      <label class="field"><span class="lbl">Ten name van</span><input id="kTnv" value="${esc(cur?.tnv||"")}" placeholder="${esc(defWho||"Naam")}"></label>
      <div class="field" style="justify-content:flex-end"><button class="btn ghost" data-saverek>Rekening opslaan</button></div>
    </div>
    <p class="note">Alleen leden van jullie huishouden zien deze rekeningnummers.</p>
    <span class="lbl" style="margin-top:6px">Meldingen op dit toestel</span>
    ${!pushSupported?`<p class="note">${ios&&!isStandalone()?"Op de iPhone werken meldingen alleen als Bonnenboek op je beginscherm staat. Installeer de app en zet meldingen daar aan.":"Dit toestel of deze browser ondersteunt geen meldingen."}</p>`
      :`<p class="note">${st.pushOn&&Notification.permission==="granted"?"Meldingen staan aan. Je krijgt een melding bij een nieuw betaalverzoek.":"Krijg een melding als er een betaalverzoek voor je klaarstaat."}</p>
      <button class="btn ${st.pushOn&&Notification.permission==="granted"?"ghost":"primary"}" data-push>${st.pushOn&&Notification.permission==="granted"?"Testmelding sturen":"Meldingen aanzetten"}</button>`}
    <p class="err" id="rErr" hidden></p>`,
  sh=>{ const err=m=>{ const e=sh.querySelector("#rErr"); e.hidden=false; e.textContent=m };
    sh.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{ const r=st.regels.slice(); r.splice(+b.dataset.rm,1); setInst({regels:r}); regelsSheet() });
    sh.querySelector("[data-add]").onclick=()=>{ const van=sh.querySelector("#rVan").value.trim(), aan=sh.querySelector("#rAan").value.trim(), pct=Math.round(+sh.querySelector("#rPct").value.replace(",",".")||100);
      if(!van||!aan) return err("Vul bij beide namen iemand in."); if(same(van,aan)) return err("Kies twee verschillende personen."); if(!(pct>=1&&pct<=100)) return err("Het percentage moet tussen 1 en 100 liggen.");
      if(st.regels.some(g=>same(g.van,van)&&same(g.aan,aan))) return err("Deze regel bestaat al.");
      setInst({regels:[...st.regels,{van,aan,pct,sinds:new Date().toISOString()}]}); toast("Regel toegevoegd"); regelsSheet() };
    const wie=sh.querySelector("#kWie"), ib=sh.querySelector("#kIban"), tn=sh.querySelector("#kTnv");
    const fill=n=>{ const r=rekVan(n); ib.value=fmtIban(r?.iban||""); tn.value=r?.tnv||""; tn.placeholder=n||"Naam" };
    wie.addEventListener("change",()=>fill(wie.value.trim()));
    sh.querySelectorAll("[data-editrek]").forEach(b=>b.onclick=()=>{ wie.value=b.dataset.editrek; fill(wie.value); ib.focus() });
    sh.querySelector("[data-saverek]").onclick=()=>{ const naam=wie.value.trim(); const iban=ib.value.replace(/\s+/g,"").toUpperCase();
      if(!naam) return err("Vul in van wie de rekening is.");
      if(iban&&!ibanOk(iban)) return err("Dit IBAN klopt niet. Controleer het nummer, bijvoorbeeld NL91 ABNA 0417 1643 00.");
      const key=Object.keys(st.rekeningen).find(k=>same(k,naam))||naam;
      setInst({rekeningen:{[key]:{iban,tnv:tn.value.trim()||naam}}}); toast(`Rekening van ${naam} opgeslagen`); regelsSheet() };
    const pb=sh.querySelector("[data-push]"); if(pb) pb.onclick=async()=>{ pb.disabled=true; try{ const r=await enablePush(); toast(`Testmelding verstuurd naar ${r.verstuurd} toestel${r.verstuurd===1?"":"len"}`); regelsSheet() }catch(e){ err(e.message) } finally{ pb.disabled=false } } });
}
function b64u(s){ s=s.replace(/-/g,"+").replace(/_/g,"/"); const raw=atob(s+"=".repeat((4-s.length%4)%4)); return Uint8Array.from(raw,c=>c.charCodeAt(0)) }
async function enablePush(silent){
  if(!st.mijnNaam) throw new Error("Stel eerst je naam in.");
  const perm=silent?Notification.permission:await Notification.requestPermission();
  if(perm!=="granted") throw new Error("Meldingen zijn geweigerd. Zet ze aan in de instellingen van je telefoon bij Bonnenboek.");
  const reg=await navigator.serviceWorker.ready; const {publicKey}=await api("GET","/api/push");
  let sub=await reg.pushManager.getSubscription(); if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64u(publicKey)});
  await api("POST","/api/push",{code:st.code,naam:st.mijnNaam,sub:sub.toJSON()});
  st.pushOn=true; save();
  if(!silent){ const r=await api("PUT","/api/push",{code:st.code,naam:st.mijnNaam});
    if(r.fouten&&r.fouten.length) throw new Error("Versturen mislukt: "+r.fouten.join("; "));
    if(!r.toestellen) throw new Error(`Geen toestel gevonden voor "${st.mijnNaam}". Bekend: ${(r.namen||[]).join(", ")||"geen"}.`);
    return r }
}
const sortRec = (a,b)=>(b.datum||"").localeCompare(a.datum||"")||(b.aangemaakt||"").localeCompare(a.aangemaakt||"");

/* ================= render ================= */
function render(){
  const onboarded=!!st.code;
  $("welcome").hidden=onboarded; $("app").hidden=!onboarded;
  if(!onboarded) return;
  document.querySelectorAll("nav.tabs a").forEach(a=>a.setAttribute("aria-current",a.dataset.v===st.view?"page":"false"));
  $("monthLabel").textContent=ymLabel(st.ym);
  $("nextM").disabled = st.ym>=ym(new Date());
  $("hhName").textContent=st.hhNaam||st.code;
  setSync(st.sync);
  if(sheetBusy()) {/* keep sheet; view below still updates */}
  if(st.view==="bonnen") renderList(); else if(st.view==="analyse") renderAnalyse(); else renderOverview();
}
const sheetBusy = () => !!$("sheetRoot").firstChild;

function budgetBlock(total){
  const b=st.budgetCent;
  if(!b) return `<div class="row"><span class="note">Nog geen maandbudget.</span><button class="linkbtn" data-act="budget">Budget instellen</button></div>`;
  const pct=Math.min(100,Math.round(total/b*100)); const now=new Date(); const isCur=st.ym===ym(now);
  const dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(); const dayPct=isCur?now.getDate()/dim:1;
  let cls="",pill;
  if(total>b){ cls="bad"; pill=`<span class="pill bad">${eur(total-b)} over budget</span>` }
  else if(isCur&&total/b>dayPct+0.1){ cls="warn"; pill=`<span class="pill warn">Sneller dan gepland</span>` }
  else pill=`<span class="pill">Nog ${eur(b-total)} over</span>`;
  return `<div class="meter ${cls}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Budget gebruikt"><i style="width:${pct}%"></i></div>
    <div class="row">${pill}<span class="note">van ${eur(b)} · <button class="linkbtn" data-act="budget">wijzig</button></span></div>`;
}
function installBanner(){
  if(isStandalone()) return "";
  try{ if(localStorage.getItem("bb.hideInstall")) return "" }catch(e){}
  return `<div class="banner"><p><b>Zet Bonnenboek op je beginscherm</b><br>Dan opent hij als app, ook met de camera.</p><button class="btn primary small" data-act="install" style="flex:none">Installeren</button><button class="iconbtn" data-act="hideInstall" aria-label="Verbergen" style="width:32px;height:32px">✕</button></div>`;
}
function renderOverview(){
  const list=monthBonnen(); const total=monthTotal(st.ym); const prev=monthTotal(shiftYm(st.ym,-1));
  const cats=byCategory(list).slice(0,6); const avg=list.length?Math.round(total/list.length):0;
  const diff=prev?Math.round((total-prev)/prev*100):null;
  let html=requestBanner()+installBanner()+`<section class="total">
      <span class="lbl">Uitgegeven aan boodschappen</span>
      <div class="big">${eur(total)}</div>
      ${budgetBlock(total)}
      <div class="kpis">
        <div class="kpi"><span class="lbl">Bonnen</span><b>${list.length}</b></div>
        <div class="kpi"><span class="lbl">Gem. per bon</span><b>${eur(avg)}</b></div>
        <div class="kpi"><span class="lbl">vs. vorige mnd</span><b>${diff===null?"—":(diff>0?"+":"")+diff+"%"}</b></div>
      </div></section>`;
  if(all().length) html+=rankCard();
  if(!all().length){
    html+=`<div class="empty">
      <svg width="54" height="62" viewBox="0 0 30 34" aria-hidden="true"><path d="M3 2h24v28l-3-2.4-3 2.4-3-2.4-3 2.4-3-2.4-3 2.4-3-2.4L3 32z" fill="none" stroke="var(--muted)" stroke-width="1.4"/><path d="M8 9h14M8 14h10M8 19h14" stroke="var(--muted)" stroke-width="1.4" stroke-linecap="round"/></svg>
      <h3>Scan je eerste kassabon</h3>
      <p>Maak een foto van een bon. Winkel, datum, totaal en alle producten worden uitgelezen en per categorie ingedeeld. Je controleert alles voordat het wordt opgeslagen.</p>
      <div class="actions"><button class="btn primary small" data-act="scan">Bon scannen</button><button class="btn ghost small" data-act="invite">Anderen uitnodigen</button></div>
    </div>`;
  } else {
    html+=`<section class="card"><div class="sechead"><h3>Waar gaat het heen?</h3><a class="linkbtn" href="#analyse">Alles</a></div>${cats.length?catBars(cats):'<p class="note">Geen bonnen in deze maand.</p>'}</section>`;
    const recent=[...list].sort(sortRec).slice(0,4);
    if(recent.length) html+=`<section class="card"><div class="sechead"><h3>Laatste bonnen</h3><a class="linkbtn" href="#bonnen">Alle ${list.length}</a></div><div class="daygroup">${recent.map(slip).join("")}</div></section>`;
  }
  $("view").innerHTML=html;
}
function catBars(cats){ const max=Math.max(...cats.map(c=>Math.abs(c[1])),1);
  return `<div class="bars">${cats.map(([n,v])=>{ const i=CATS.indexOf(n); const col=n==="Niet ingedeeld"?"var(--muted)":CAT_COLOR(i<0?7:i);
    return `<div class="bar"><span class="n">${esc(n)}</span><span class="v">${eur(v)}</span><span class="t"><i style="width:${Math.max(2,Math.abs(v)/max*100)}%;background:${col}"></i></span></div>` }).join("")}</div>` }
function slip(r){ const n=(r.items||[]).length;
  return `<button class="slip" data-open="${esc(r.id)}">
    <span class="store" style="background:${storeColor(r.winkel)}">${esc(initials(r.winkel))}</span>
    <span style="min-width:0;display:flex;flex-direction:column"><span class="nm">${esc(r.winkel)}${r._pend?'<span class="tag pend">nog niet gedeeld</span>':(r.bron==="scan"?'<span class="tag">gescand</span>':"")}</span><span class="who">${n?n+" product"+(n===1?"":"en"):"Alleen totaal"}${" · "+esc(payer(r))}</span></span>
    <span class="amt">${eur(r.totaalCent)}</span></button>` }

function renderList(){
  let list=monthBonnen().sort(sortRec); const q=st.query.trim().toLowerCase();
  if(q) list=list.filter(r=>(r.winkel||"").toLowerCase().includes(q)||(r.items||[]).some(i=>(i.naam||"").toLowerCase().includes(q)));
  const ppl=byPerson(monthBonnen()).map(([n])=>n);
  if(st.person&&!ppl.includes(st.person)) st.person="";
  if(st.person) list=list.filter(r=>payer(r)===st.person);
  let html=`<input class="search" id="q" type="search" placeholder="Zoek op winkel of product…" value="${esc(st.query)}" aria-label="Zoeken">`;
  if(ppl.length>1) html+=`<div class="chips" role="group" aria-label="Ingevoerd door"><button class="chip" data-person-filter="" aria-pressed="${!st.person}">Iedereen</button>${ppl.map(n=>`<button class="chip" data-person-filter="${esc(n)}" aria-pressed="${st.person===n}">${esc(n)}</button>`).join("")}</div>`;
  if(st.person&&list.length) html+=`<p class="note">${esc(st.person)} betaalde ${list.length} bon${list.length===1?"":"nen"}, samen <b class="num">${eur(list.reduce((a,r)=>a+r.totaalCent,0))}</b>.</p>`;
  if(!list.length) html+=`<div class="empty"><h3>${q?"Niets gevonden":"Geen bonnen in "+ymLabel(st.ym)}</h3><p>${q?"Probeer een andere zoekterm.":"Scan een bon of voer er een handmatig in."}</p></div>`;
  else { const groups={}; for(const r of list) (groups[r.datum]=groups[r.datum]||[]).push(r);
    for(const d of Object.keys(groups)){ const tot=groups[d].reduce((a,r)=>a+r.totaalCent,0);
      html+=`<div class="daygroup"><div class="sechead"><span class="lbl">${esc(dayLabel(d))}</span><span class="lbl num">${eur(tot)}</span></div>${groups[d].map(slip).join("")}</div>` } }
  html+=`<div class="actions"><button class="btn ghost small" data-act="export">Exporteer ${esc(ymLabel(st.ym))} (CSV)</button><button class="btn ghost small" data-act="exportAll">Alles exporteren</button></div>`;
  const hadFocus=document.activeElement&&document.activeElement.id==="q"; const pos=hadFocus?document.activeElement.selectionStart:0;
  $("view").innerHTML=html;
  const qi=$("q"); qi.addEventListener("input",()=>{ st.query=qi.value; renderList() });
  if(hadFocus){ qi.focus(); qi.setSelectionRange(pos,pos) }
}
function renderAnalyse(){
  const list=monthBonnen(); const months=[...Array(6)].map((_,i)=>shiftYm(st.ym,i-5));
  const totals=months.map(monthTotal); const b=st.budgetCent||0; const max=Math.max(...totals,b,1);
  const trend=`<div class="trend">${b?`<div class="budgetline" style="bottom:calc(${b/max} * (100% - 58px) + 22px)"><span>budget ${eurShort(b)}</span></div>`:""}
    ${months.map((m,i)=>`<div class="col ${m===st.ym?"cur":""}"><span class="val">${totals[i]?eurShort(totals[i]):"–"}</span><span class="stick" style="height:calc(${totals[i]/max} * (100% - 58px))"></span><span class="m">${ymLabel(m,true)}</span></div>`).join("")}</div>`;
  const cats=byCategory(list); const stores=byStore(list);
  const pm={}; for(const r of list) for(const i of r.items||[]){ if(i.cat==="Korting"||i.cat==="Statiegeld") continue; const k=(i.naam||"").trim(); if(!k) continue; pm[k]=pm[k]||{c:0,n:0}; pm[k].c+=i.cent; pm[k].n+=Number(i.aantal)||1 }
  const prods=Object.entries(pm).sort((a,b)=>b[1].c-a[1].c).slice(0,8);
  const kort=-(cats.find(c=>c[0]==="Korting")?.[1]||0);
  const nonzero=totals.filter(Boolean);
  let html=`<section class="card"><div class="sechead"><h3>Laatste 6 maanden</h3><span class="lbl num">gem. ${eur(nonzero.length?Math.round(nonzero.reduce((a,b)=>a+b,0)/nonzero.length):0)}</span></div>${trend}</section>`;
  html+=`<section class="card"><div class="sechead"><h3>Per categorie</h3>${kort>0?`<span class="pill">${eur(kort)} korting</span>`:""}</div>${cats.length?catBars(cats):'<p class="note">Geen bonnen in deze maand.</p>'}</section>`;
  html+=`<section class="card"><h3>Per winkel</h3>${stores.length?`<div class="stores">${stores.map(([n,o])=>`<div class="r"><span class="store" style="background:${storeColor(n)}">${esc(initials(n))}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n)}</span><span class="c">${o.n}×</span><span class="num">${eur(o.c)}</span></div>`).join("")}</div>`:'<p class="note">Nog geen winkels deze maand.</p>'}</section>`;
  html+=`<section class="card"><h3>Grootste posten</h3>${prods.length?`<div class="toplist">${prods.map(([n,o])=>`<div class="r"><span>${esc(n)}</span><span class="note num">${o.n}×</span><span class="num">${eur(o.c)}</span></div>`).join("")}</div>`:'<p class="note">Scan bonnen met productregels om dit te zien.</p>'}</section>`;
  $("view").innerHTML=html;
}

/* ================= sheets ================= */
let lastFocus=null;
function openSheet(html,onMount){ lastFocus=lastFocus||document.activeElement;
  $("sheetRoot").innerHTML=`<div class="overlay" data-close-bg><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const sh=$("sheetRoot").querySelector(".sheet"); onMount&&onMount(sh);
  const x=sh.querySelector("[data-x]"); if(x&&!x.onclick) x.onclick=closeSheet;
  sh.scrollTop=0 }
function closeSheet(){ $("sheetRoot").innerHTML=""; scanQueue=[]; picked=[]; if(lastFocus&&lastFocus.focus) lastFocus.focus(); lastFocus=null }
$("sheetRoot").addEventListener("click",e=>{ if(e.target.hasAttribute&&e.target.hasAttribute("data-close-bg")) closeSheet() });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&sheetBusy()) closeSheet() });
const head = t => `<header><h2>${esc(t)}</h2><button class="iconbtn" data-x aria-label="Sluiten">✕</button></header>`;

function detailSheet(id){
  const r=st.bonnen[id]; if(!r) return; const items=r.items||[]; const rest=r.totaalCent-sumItems(items);
  openSheet(`${head(r.winkel)}
    <div class="receipt-head"><b>${eur(r.totaalCent)}</b><span class="note">${esc(dayLabel(r.datum))}${r.betaalwijze?" · "+esc(r.betaalwijze):""}</span><span class="note">Ingevoerd door <b>${esc(buyer(r))}</b></span></div>
    ${items.length?`<div class="detail-items">${items.map(i=>`<div class="r"><span>${esc(i.naam)}${i.aantal>1?" ×"+i.aantal:""}<small>${esc(i.cat)}</small></span><span class="num">${eur(i.cent)}</span></div>`).join("")}</div>`:'<p class="note">Voor deze bon is alleen het totaal ingevoerd.</p>'}
    ${items.length&&Math.abs(rest)>1?`<p class="note">Verschil met totaal: <span class="num diff">${eur(rest)}</span></p>`:""}
    <div class="actions" id="dAct"><button class="btn primary" data-edit>Bewerken</button><button class="btn danger" data-del>Verwijderen</button></div>`,
  sh=>{ sh.querySelector("[data-edit]").onclick=()=>editSheet(JSON.parse(JSON.stringify(r)));
    sh.querySelector("[data-del]").onclick=()=>{ sh.querySelector("#dAct").outerHTML=`<div class="confirm"><b>Deze bon van ${esc(r.winkel)} (${eur(r.totaalCent)}) verwijderen?</b><p class="note">Hij verdwijnt ook op de andere telefoons.</p><div class="actions"><button class="btn danger" data-yes>Ja, verwijderen</button><button class="btn ghost" data-no>Annuleren</button></div></div>`;
      sh.querySelector("[data-no]").onclick=()=>detailSheet(id);
      sh.querySelector("[data-yes]").onclick=()=>{ delBon(id); closeSheet(); toast("Bon verwijderd") } } });
}

function editSheet(r,info){
  r.items=r.items||[];
  const catOpts=sel=>CATS.map(c=>`<option${c===sel?" selected":""}>${esc(c)}</option>`).join("");
  const itemRow=(i,k)=>`<div class="item" data-k="${k}"><input aria-label="Product" data-f="naam" value="${esc(i.naam)}" placeholder="Product"><input class="p" aria-label="Prijs" data-f="cent" inputmode="decimal" value="${i.cent?centToInput(i.cent):""}" placeholder="0,00"><button class="x" data-rm="${k}" aria-label="Regel verwijderen">×</button><select class="cat" aria-label="Categorie" data-f="cat">${catOpts(i.cat||"Overig")}</select></div>`;
  const stores=[...new Set(["Albert Heijn","Jumbo","Lidl","Aldi","Plus","Dirk","Coop","Vomar","Hoogvliet","Picnic",...all().map(x=>x.winkel)])];
  const more=scanQueue.length>0;
  openSheet(`${head(r.id?"Bon bewerken":(r.bron==="scan"?"Controleer de bon":"Bon invoeren"))}
    ${info?`<p class="note">${esc(info)}</p>`:""}${r._warn?`<p class="err">${esc(r._warn)}</p>`:""}
    <div class="grid2">
      <label class="field"><span class="lbl">Winkel</span><input id="eWinkel" list="storeList" value="${esc(r.winkel||"")}" placeholder="Bijv. Albert Heijn"></label>
      <label class="field"><span class="lbl">Datum</span><input id="eDatum" type="date" value="${esc(r.datum||today())}"></label>
      <label class="field"><span class="lbl">Totaal betaald</span><input id="eTotaal" class="mono" inputmode="decimal" value="${r.totaalCent?centToInput(r.totaalCent):""}" placeholder="0,00"></label>
      <label class="field"><span class="lbl">Betaalwijze</span><select id="eBetaal">${["","pin","contant","creditcard","anders"].map(o=>`<option value="${o}"${o===(r.betaalwijze||"")?" selected":""}>${o||"—"}</option>`).join("")}</select></label>
    </div>
    <p class="note">${r.id?`Ingevoerd door <b>${esc(r.door||"onbekend")}</b>.`:(st.mijnNaam?`Deze bon telt mee voor <b>${esc(st.mijnNaam)}</b>.`:`Stel je naam in (rechtsboven) zodat de bon op jouw naam komt.`)}</p>
    <datalist id="storeList">${stores.map(s=>`<option value="${esc(s)}">`).join("")}</datalist>
    <div class="sechead"><span class="lbl">Producten (optioneel)</span><button class="linkbtn" data-add>+ Regel</button></div>
    <div class="items" id="eItems">${r.items.map(itemRow).join("")}</div>
    <div class="sumline" id="eSum"></div>
    <p class="err" id="eErr" hidden></p>
    <div class="actions"><button class="btn primary" data-save>${more?"Opslaan & volgende":"Opslaan"}</button>${more?`<button class="btn ghost" data-skip>Overslaan</button>`:""}</div>`,
  sh=>{
    const read=()=>sh.querySelectorAll(".item").forEach(el=>{ const i=r.items[+el.dataset.k]; if(!i) return; i.naam=el.querySelector('[data-f="naam"]').value; i.cent=parseEur(el.querySelector('[data-f="cent"]').value); i.cat=el.querySelector('[data-f="cat"]').value });
    const upd=()=>{ read(); const s=sumItems(r.items); const t=parseEur(sh.querySelector("#eTotaal").value); const d=t-s;
      sh.querySelector("#eSum").innerHTML=r.items.length?`<span>Som producten <b>${eur(s)}</b></span>${Math.abs(d)>1?`<span class="diff">Verschil met totaal ${eur(d)}</span>`:`<span>Klopt met totaal ✓</span>`}`:`<span>Zonder productregels telt het totaal als "Niet ingedeeld".</span>` };
    const redraw=()=>{ read(); sh.querySelector("#eItems").innerHTML=r.items.map(itemRow).join(""); upd() };
    sh.addEventListener("input",upd); upd();
    sh.querySelector("[data-add]").onclick=()=>{ r.items.push({naam:"",cent:0,cat:"Overig",aantal:1}); redraw(); const els=sh.querySelectorAll(".item input[data-f=naam]"); els[els.length-1].focus() };
    sh.querySelector("#eItems").addEventListener("click",e=>{ const k=e.target.dataset.rm; if(k!==undefined){ read(); r.items.splice(+k,1); redraw() } });
    const skip=sh.querySelector("[data-skip]"); if(skip) skip.onclick=()=>nextInQueue();
    sh.querySelector("[data-save]").onclick=()=>{ read(); const err=sh.querySelector("#eErr");
      r.winkel=sh.querySelector("#eWinkel").value.trim(); r.datum=sh.querySelector("#eDatum").value||today(); r.betaalwijze=sh.querySelector("#eBetaal").value;
      r.totaalCent=parseEur(sh.querySelector("#eTotaal").value); if(!r.totaalCent&&r.items.length) r.totaalCent=sumItems(r.items);
      if(!r.winkel){ err.hidden=false; err.textContent="Vul de naam van de winkel in."; return }
      if(!r.totaalCent){ err.hidden=false; err.textContent="Vul het totaalbedrag in, bijvoorbeeld 23,45."; return }
      const wasEdit=!!r.id; const saved=putBon(r);
      const vz=!wasEdit&&st.regels.find(g=>same(g.van,buyer(saved)));
      toast(wasEdit?"Bon bijgewerkt":vz?`Bon opgeslagen · betaalverzoek van ${eur(Math.round(saved.totaalCent*vz.pct/100))} naar ${vz.aan}`:"Bon opgeslagen · "+eur(saved.totaalCent));
      if(saved.datum&&!saved.datum.startsWith(st.ym)){ st.ym=saved.datum.slice(0,7); render() }
      if(scanQueue.length) nextInQueue(); else closeSheet() };
  });
}

function budgetSheet(){
  openSheet(`${head("Maandbudget")}
    <p class="note">Hoeveel willen jullie per maand aan boodschappen uitgeven? Het budget geldt voor het hele huishouden.</p>
    <label class="field"><span class="lbl">Budget per maand</span><input id="bIn" class="mono" inputmode="decimal" value="${st.budgetCent?centToInput(st.budgetCent):""}" placeholder="600,00"></label>
    <div class="actions"><button class="btn primary" data-save>Opslaan</button>${st.budgetCent?`<button class="btn ghost" data-clear>Geen budget</button>`:""}</div>`,
  sh=>{ sh.querySelector("[data-save]").onclick=()=>{ setBudget(parseEur(sh.querySelector("#bIn").value)||null); closeSheet(); toast("Budget opgeslagen") };
    const c=sh.querySelector("[data-clear]"); if(c) c.onclick=()=>{ setBudget(null); closeSheet() } });
}

function inviteLink(){ return location.origin+"/?code="+encodeURIComponent(st.code) }
function settingsSheet(){
  const pend=st.queue.length; const last=st.lastSync?new Date(st.lastSync).toLocaleString("nl-NL",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"nog niet";
  openSheet(`${head(st.hhNaam||"Huishouden")}
    <span class="lbl">Huishoudcode</span>
    <div class="codebox" id="codeBox">${esc(st.code)}</div>
    <p class="note">Iedereen met deze code ziet en bewerkt dezelfde bonnen. Deel hem alleen met je huisgenoten.</p>
    <div class="actions"><button class="btn primary" data-share>Uitnodiging delen</button><button class="btn ghost" data-copy>Link kopiëren</button></div>
    <button class="btn ghost" data-regels>Betaalverzoeken${st.regels.length?` (${st.regels.length} regel${st.regels.length>1?"s":""})`:""}</button>
    <label class="field"><span class="lbl">Jouw naam (zichtbaar bij je bonnen)</span><input class="inp" id="sNaam" value="${esc(st.mijnNaam)}"></label>
    <p class="note">Laatst bijgewerkt: ${esc(last)}${pend?` · ${pend} wijziging${pend>1?"en":""} wacht${pend>1?"en":""} op verbinding`:""}</p>
    <div class="actions">${isStandalone()?"":`<button class="btn ghost" data-install>App installeren</button>`}<a class="btn ghost" href="/handleiding.html">Handleiding</a></div>
    <button class="linkbtn" data-leave style="align-self:flex-start;color:var(--bad)">Dit toestel loskoppelen van het huishouden</button>`,
  sh=>{ sh.querySelector("[data-share]").onclick=shareInvite;
    sh.querySelector("[data-copy]").onclick=()=>copy(inviteLink(),"Link gekopieerd");
    sh.querySelector("#sNaam").addEventListener("change",e=>{ st.mijnNaam=e.target.value.trim(); save(); toast("Naam opgeslagen"); if(st.pushOn) enablePush(true).catch(()=>{}) });
    sh.querySelector("[data-regels]").onclick=regelsSheet;
    const ib=sh.querySelector("[data-install]"); if(ib) ib.onclick=installFlow;
    sh.querySelector("[data-leave]").onclick=()=>{ openSheet(`${head("Loskoppelen?")}<p class="note">De bonnen blijven bewaard voor de anderen. Je kunt later weer meedoen met code <b class="mono">${esc(st.code)}</b>.</p>${st.queue.length?`<p class="err">Let op: ${st.queue.length} wijziging(en) zijn nog niet verstuurd en gaan verloren.</p>`:""}<div class="actions"><button class="btn danger" data-yes>Loskoppelen</button><button class="btn ghost" data-no>Annuleren</button></div>`,
      s2=>{ s2.querySelector("[data-no]").onclick=settingsSheet; s2.querySelector("[data-yes]").onclick=()=>{ Object.assign(st,{code:null,hhNaam:"",bonnen:{},queue:[],budgetCent:null,regels:[],rekeningen:{},lastSync:null}); save(); closeSheet(); render() } }) } });
}
async function shareInvite(){
  const text=`Doe mee met ons Bonnenboek "${st.hhNaam}" om samen de boodschappen bij te houden. Code: ${st.code}`;
  if(navigator.share){ try{ await navigator.share({title:"Bonnenboek",text,url:inviteLink()}); return }catch(e){ if(e.name==="AbortError") return } }
  copy(text+"\n"+inviteLink(),"Uitnodiging gekopieerd");
}
function copy(text,msg){ (navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).then(()=>toast(msg),()=>{ const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); toast(msg) }catch(e){ toast("Kopiëren lukte niet") } ta.remove() }) }

/* ================= install ================= */
function isStandalone(){ return matchMedia("(display-mode: standalone)").matches||navigator.standalone===true }
addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); installEvt=e });
addEventListener("appinstalled",()=>{ installEvt=null; toast("Bonnenboek is geïnstalleerd"); render() });
async function installFlow(){
  if(installEvt){ installEvt.prompt(); const r=await installEvt.userChoice.catch(()=>null); installEvt=null; if(r&&r.outcome==="accepted") closeSheet(); return }
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  openSheet(`${head("Op je beginscherm zetten")}
    ${ios?`<ol class="steps"><li>Open deze pagina in <b>Safari</b>.</li><li>Tik onderin op de <b>Deel-knop</b> (vierkant met pijl omhoog).</li><li>Kies <b>Zet op beginscherm</b> en tik op <b>Voeg toe</b>.</li></ol>`
    :`<ol class="steps"><li>Open deze pagina in <b>Chrome</b>.</li><li>Tik rechtsboven op het menu <b>⋮</b>.</li><li>Kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.</li></ol>`}
    <p class="note">Daarna open je Bonnenboek als gewone app. Je blijft automatisch in hetzelfde huishouden.</p>`);
}

/* ================= scanning ================= */
let scanQueue=[], scanTotal=0, picked=[];
const isPdf = f => f && (f.type==="application/pdf"||/\.pdf$/i.test(f.name||""));
const isImg = f => f && (f.type.startsWith("image/")||/\.(heic|heif|jpe?g|png|webp)$/i.test(f.name||""));
function thumb(f){
  if(f.text!==undefined) return `<span class="doc"><b>TEKST</b><small>${esc(f.text.slice(0,40))}…</small></span>`;
  if(isPdf(f)) return `<span class="doc"><b>PDF</b><small>${esc(f.name||"bon.pdf")}</small></span>`;
  return `<img src="${URL.createObjectURL(f)}" alt="Gekozen bon">`;
}
function scanSheet(){
  picked=picked||[];
  const draw=()=>{ const sh=$("sheetRoot").querySelector(".sheet"); if(!sh||!sh.querySelector("#pv")) return;
    sh.querySelector("#pv").innerHTML=picked.map(thumb).join("");
    const n=picked.length; sh.querySelector("#pickInfo").textContent=n?`${n} bestand${n>1?"en":""} gekozen`:"Nog niets gekozen";
    sh.querySelector("#oneWrap").hidden=n<2; sh.querySelector("[data-go]").disabled=!n;
    sh.querySelector("[data-cam]").textContent=n?"Nog een foto":"Foto maken" };
  scanSheet.draw=draw;
  openSheet(`${head("Bon toevoegen")}
    <p class="note">Fotografeer een papieren bon, of kies een digitale bon: een schermafbeelding uit de app van de winkel of een PDF.</p>
    <div class="preview" id="pv"></div>
    <p class="lbl" id="pickInfo"></p>
    <div class="actions"><button class="btn primary" data-cam>Foto maken</button><button class="btn ghost" data-gal>Digitale bon of foto kiezen</button></div>
    <button class="linkbtn" data-text style="align-self:flex-start">Tekst van een e-mailbon plakken</button>
    <label class="toggle" id="oneWrap" hidden><input type="checkbox" id="oneBon"> Alles hoort bij één bon</label>
    <button class="btn primary" data-go disabled>Uitlezen</button>`,
  sh=>{ sh.querySelector("[data-x]").onclick=()=>{ picked=[]; closeSheet() };
    sh.querySelector("[data-cam]").onclick=()=>$("fileCam").click(); sh.querySelector("[data-gal]").onclick=()=>$("fileGal").click();
    sh.querySelector("[data-text]").onclick=textSheet;
    sh.querySelector("[data-go]").onclick=()=>{ const one=sh.querySelector("#oneBon").checked; const files=picked; picked=[];
      runQueue(one||files.length===1?[files]:files.map(f=>[f])) }; draw() });
}
function textSheet(){
  openSheet(`${head("Tekst plakken")}
    <p class="note">Open de e-mail of de bon in de app van de winkel, selecteer alle tekst, kopieer en plak hem hieronder.</p>
    <textarea id="tIn" class="inp mono" style="min-height:220px;font-size:13px" placeholder="Plak hier de tekst van de bon"></textarea>
    <div class="actions"><button class="btn primary" data-go>Uitlezen</button><button class="btn ghost" data-back>Terug</button></div>`,
  sh=>{ sh.querySelector("[data-back]").onclick=scanSheet;
    sh.querySelector("[data-go]").onclick=()=>{ const t=sh.querySelector("#tIn").value.trim(); if(t.length<10){ toast("Plak eerst de tekst van de bon"); return } runQueue([[{text:t.slice(0,30000)}]]) };
  });
}
function addFiles(list){ let skipped=0; for(const f of list){ if(isImg(f)||isPdf(f)) picked.push(f); else skipped++ }
  if(skipped) toast("Alleen foto's, schermafbeeldingen en PDF's kunnen worden uitgelezen");
  if(!$("sheetRoot").querySelector("#pv")) scanSheet(); else scanSheet.draw() }
$("fileCam").onchange=e=>{ addFiles(e.target.files); e.target.value="" };
$("fileGal").onchange=e=>{ addFiles(e.target.files); e.target.value="" };

function readDataUrl(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error("decode")); r.readAsDataURL(f) }) }
async function prepare(item){
  if(item.text!==undefined) return {text:item.text};
  if(isPdf(item)){ if(item.size>4e6) throw new Error("Deze PDF is te groot (meer dan 4 MB). Maak een schermafbeelding van de bon."); const d=await readDataUrl(item); return {file:d.replace(/^data:[^;]*;/,"data:application/pdf;")} }
  return {file:await compress(item)};
}
async function compress(file){
  const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error("decode")); i.src=URL.createObjectURL(file) });
  const maxLong=2000, maxPx=3.2e6; let w=img.naturalWidth, h=img.naturalHeight;
  let s=Math.min(1,maxLong/Math.max(w,h)); if(w*h*s*s>maxPx) s=Math.sqrt(maxPx/(w*h));
  const c=document.createElement("canvas"); c.width=Math.round(w*s); c.height=Math.round(h*s);
  const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
  return c.toDataURL("image/jpeg",0.82);
}
function runQueue(groups){ scanQueue=groups.slice(); scanTotal=groups.length; nextInQueue() }
async function nextInQueue(){
  const grp=scanQueue.shift(); if(!grp){ closeSheet(); return }
  const idx=scanTotal-scanQueue.length; const label=scanTotal>1?`Bon ${idx} van ${scanTotal}`:"";
  let cancelled=false;
  openSheet(`<div class="scanning"><div class="roll" aria-hidden="true"></div><h2>Bon uitlezen…</h2>
    <p class="note">${label?esc(label)+" · ":""}Winkel, datum en producten worden herkend. Dit duurt meestal 10 tot 30 seconden.</p>
    <div class="preview" style="justify-content:center">${grp.map(thumb).join("")}</div>
    <div class="actions"><button class="btn ghost" data-stop>Stoppen</button></div></div>`,
  sh=>{ sh.querySelector("[data-stop]").onclick=()=>{ cancelled=true; closeSheet() } });
  const info=scanQueue.length?`${label} · daarna nog ${scanQueue.length}`:label;
  try{
    if(!navigator.onLine) throw Object.assign(new Error("offline"),{status:0});
    const parts=await Promise.all(grp.map(prepare));
    const images=parts.filter(p=>p.file).map(p=>p.file); const text=parts.filter(p=>p.text).map(p=>p.text).join("\n\n");
    const res=await api("POST","/api/scan",{code:st.code,images,text},70000);
    if(cancelled) return;
    if(!res||res.isBon===false){ failSheet("Geen bon herkend","Hierin is geen kassabon te herkennen. Maak een foto recht van boven met de hele bon in beeld, of kies een schermafbeelding of PDF van de digitale bon."); return }
    const items=(Array.isArray(res.items)?res.items:[]).map(i=>({naam:String(i.naam||"").trim(),aantal:Number(i.aantal)||1,cent:parseEur(i.prijs),cat:CATS.includes(i.categorie)?i.categorie:"Overig"}));
    const datum=/^\d{4}-\d{2}-\d{2}$/.test(res.datum||"")?res.datum:today();
    const r={bron:"scan",winkel:String(res.winkel||"").trim(),datum,totaalCent:parseEur(res.totaal),betaalwijze:["pin","contant","creditcard","anders"].includes(res.betaalwijze)?res.betaalwijze:"",items};
    if(!res.datum) r._warn="De datum was niet leesbaar; vandaag is ingevuld.";
    editSheet(r,info);
  }catch(e){
    if(cancelled) return;
    const msg=e.status===0?"Er is geen internetverbinding. Scannen werkt alleen online; je kunt de bon wel handmatig invoeren.":(e.message==="decode"?"Dit bestand kon niet worden geopend. Kies een foto, schermafbeelding of PDF.":e.message);
    failSheet("Uitlezen mislukt",msg);
  }
}
function failSheet(title,msg){
  openSheet(`${head(title)}<p class="err">${esc(msg)}</p><div class="actions"><button class="btn primary" data-again>Opnieuw scannen</button><button class="btn ghost" data-man>Handmatig invoeren</button>${scanQueue.length?'<button class="btn ghost" data-next>Volgende bon</button>':""}</div>`,
    sh=>{ sh.querySelector("[data-again]").onclick=()=>{ scanQueue=[]; scanSheet() }; sh.querySelector("[data-man]").onclick=()=>editSheet({bron:"handmatig",items:[]}); const n=sh.querySelector("[data-next]"); if(n) n.onclick=nextInQueue });
}

/* ================= export ================= */
function exportCsv(allMonths){
  const list=(allMonths?all():monthBonnen()).sort((a,b)=>(a.datum||"").localeCompare(b.datum||""));
  if(!list.length){ toast("Geen bonnen om te exporteren"); return }
  const q=v=>`"${String(v??"").replace(/"/g,'""')}"`; const n=c=>((c||0)/100).toFixed(2).replace(".",",");
  const rows=[["Datum","Winkel","Product","Aantal","Bedrag","Categorie","Bontotaal","Betaalwijze","Gekocht door","Betaald door","Ingevoerd door"].join(";")];
  for(const r of list){ if(!(r.items||[]).length) rows.push([r.datum,q(r.winkel),"","",n(r.totaalCent),"Niet ingedeeld",n(r.totaalCent),r.betaalwijze||"",q(buyer(r)),q(payer(r)),q(r.door)].join(";"));
    else for(const i of r.items) rows.push([r.datum,q(r.winkel),q(i.naam),i.aantal||1,n(i.cent),q(i.cat),n(r.totaalCent),r.betaalwijze||"",q(buyer(r)),q(payer(r)),q(r.door)].join(";")) }
  const blob=new Blob(["﻿"+rows.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const name=allMonths?"boodschappen-alles.csv":`boodschappen-${st.ym}.csv`;
  const file=new File([blob],name,{type:"text/csv"});
  if(navigator.canShare&&navigator.canShare({files:[file]})){ navigator.share({files:[file],title:name}).catch(()=>{}); return }
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

/* ================= onboarding ================= */
async function join(code){
  const err=$("wErr"); err.hidden=true;
  try{ const r=await api("GET","/api/huishouden?code="+encodeURIComponent(code)); st.code=r.code; st.hhNaam=r.naam; st.bonnen={}; st.queue=[]; save(); history.replaceState(null,"",location.pathname+"#overzicht"); render(); sync(); toast("Welkom bij "+r.naam) }
  catch(e){ err.hidden=false; err.textContent=e.status===404?"Deze code bestaat niet. Controleer de 8 tekens.":e.message }
}
$("wNaam").addEventListener("change",e=>{ st.mijnNaam=e.target.value.trim(); save() });
$("wNew").onclick=async e=>{ const err=$("wErr"); err.hidden=true; st.mijnNaam=$("wNaam").value.trim(); e.target.disabled=true;
  try{ const r=await api("POST","/api/huishouden",{naam:$("wHh").value.trim()}); st.code=r.code; st.hhNaam=r.naam; st.bonnen={}; st.queue=[]; save(); render(); sync(); settingsSheet() }
  catch(x){ err.hidden=false; err.textContent=x.message } finally{ e.target.disabled=false } };
$("wJoin").onclick=()=>{ st.mijnNaam=$("wNaam").value.trim(); save(); const c=$("wCode").value.trim(); if(!c){ $("wErr").hidden=false; $("wErr").textContent="Vul eerst de code in."; return } join(c) };
$("wCode").addEventListener("keydown",e=>{ if(e.key==="Enter") $("wJoin").click() });

/* ================= events ================= */
$("scanBtn").onclick=scanSheet;
$("manualBtn").onclick=()=>editSheet({bron:"handmatig",items:[]});
$("hhBtn").onclick=settingsSheet;
$("prevM").onclick=()=>{ st.ym=shiftYm(st.ym,-1); render() };
$("nextM").onclick=()=>{ if(st.ym<ym(new Date())){ st.ym=shiftYm(st.ym,1); render() } };
$("view").addEventListener("click",e=>{ const o=e.target.closest("[data-open]"); if(o){ detailSheet(o.dataset.open); return }
  const pr=e.target.closest("[data-person]"); if(pr){ st.person=pr.dataset.person; st.query=""; location.hash="bonnen"; return }
  const pf=e.target.closest("[data-person-filter]"); if(pf){ st.person=pf.dataset.personFilter; renderList(); return }
  const a=e.target.closest("[data-act]"); if(!a) return; const act=a.dataset.act;
  if(act==="verzoeken") verzoekenSheet(); else if(act==="budget") budgetSheet(); else if(act==="scan") scanSheet(); else if(act==="invite") settingsSheet();
  else if(act==="export") exportCsv(false); else if(act==="exportAll") exportCsv(true);
  else if(act==="install") installFlow(); else if(act==="hideInstall"){ try{ localStorage.setItem("bb.hideInstall","1") }catch(e){} render() } });
$("view").addEventListener("change",e=>{ if(e.target.id==="rankPeriod"){ st.rankPeriod=e.target.value; redrawRank(); $("rankPeriod").focus() }
  else if(e.target.id==="rankSort"){ st.rankSort=e.target.value; redrawRank(); $("rankSort").focus() } });
function redrawRank(){ const el=$("ranglijst"); if(el) el.outerHTML=rankCard() }
const VIEWS=["overzicht","bonnen","analyse"];
function route(){ const h=location.hash.slice(1); st.view=VIEWS.includes(h)?h:"overzicht"; render(); scrollTo(0,0)
  if(h==="verzoeken"&&st.code){ history.replaceState(null,"",location.pathname+"#overzicht"); verzoekenSheet() } }
addEventListener("hashchange",route);

/* ================= boot ================= */
load();
const urlCode=new URLSearchParams(location.search).get("code");
if(urlCode&&!st.code){ $("wCode").value=urlCode; }
else if(urlCode&&st.code&&urlCode.toUpperCase().replace(/[^A-Z0-9]/g,"")!==st.code.replace("-","")){ toast("Je zit al in een huishouden. Koppel eerst los via de knop rechtsboven.") }
if(st.code&&urlCode) history.replaceState(null,"",location.pathname+location.hash);
if(st.mijnNaam) $("wNaam").value=st.mijnNaam;
route();
if(st.code) sync();
if(st.code&&st.pushOn&&"Notification" in window&&Notification.permission==="granted") setTimeout(()=>enablePush(true).catch(()=>{}),3000);
if(new URLSearchParams(location.search).has("gedeeld")) receiveShared();
async function receiveShared(){
  history.replaceState(null,"",location.pathname+location.hash);
  if(!("caches" in window)) return;
  try{
    const cache=await caches.open("bonnenboek-gedeeld"); const files=[]; let text="";
    for(const req of await cache.keys()){ const res=await cache.match(req); const p=new URL(req.url).pathname;
      if(p==="/gedeeld/tekst") text=await res.text();
      else{ const b=await res.blob(); files.push(new File([b],decodeURIComponent(res.headers.get("x-name")||"bon"),{type:b.type||res.headers.get("content-type")||""})) }
      await cache.delete(req) }
    if(!st.code){ toast("Maak eerst een huishouden aan of doe mee, en deel de bon daarna opnieuw."); return }
    if(files.length){ picked=[]; addFiles(files) }
    else if(text.length>=10){ textSheet(); const t=$("tIn"); if(t) t.value=text }
  }catch(e){ toast("De gedeelde bon kon niet worden geopend.") }
}
if("serviceWorker" in navigator){
  const hadController=!!navigator.serviceWorker.controller; let reloading=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(!hadController||reloading||sheetBusy()) return; reloading=true; location.reload() });
  addEventListener("load",()=>navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(reg=>{
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") reg.update().catch(()=>{}) });
  }).catch(()=>{}));
}
})();
