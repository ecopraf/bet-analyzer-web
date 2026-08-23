const express = require("express");
// Per locale usa puppeteer, per Render usa puppeteer-core
const isLocal = !process.env.RENDER;
const puppeteer = isLocal ? require("puppeteer") : require("puppeteer-core");
const chromium = isLocal ? null : require("@sparticuz/chromium");

const app = express();
const PORT = process.env.PORT || 3000;

let cachedData = null;
let lastUpdate = null;

// Modello Poisson
function poisson(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
}

function calcola1X2(lC, lO) {
  let p1 = 0, pX = 0, p2 = 0;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = poisson(i, lC) * poisson(j, lO);
      if (i > j) p1 += p;
      else if (i === j) pX += p;
      else p2 += p;
    }
  }
  return { p1: p1 * 100, pX: pX * 100, p2: p2 * 100 };
}

function calcolaOU(lC, lO) {
  let under = 0;
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++)
      if (i + j < 3) under += poisson(i, lC) * poisson(j, lO);
  return { over: (1 - under) * 100, under: under * 100 };
}

function calcolaGG(lC, lO) {
  let ng = 0;
  for (let i = 0; i <= 8; i++) {
    ng += poisson(i, lC) * poisson(0, lO);
    if (i > 0) ng += poisson(0, lC) * poisson(i, lO);
  }
  return { gol: (1 - ng) * 100, nogol: ng * 100 };
}

// Forza squadre
const FORZA = {
  "inter": [1.35, 0.75], "milan": [1.2, 0.9], "juventus": [1.15, 0.8], "napoli": [1.25, 0.85],
  "roma": [1.1, 0.95], "atalanta": [1.3, 0.9], "lazio": [1.15, 1.0], "fiorentina": [1.05, 1.0],
  "torino": [0.95, 0.95], "bologna": [1.0, 1.0], "monza": [0.85, 1.15], "sassuolo": [0.9, 1.2],
  "manchester city": [1.5, 0.65], "arsenal": [1.3, 0.75], "liverpool": [1.35, 0.8],
  "chelsea": [1.15, 0.9], "tottenham": [1.2, 0.95], "newcastle": [1.15, 0.9],
  "real madrid": [1.4, 0.7], "barcellona": [1.45, 0.75], "atletico": [1.1, 0.8],
  "bayern": [1.55, 0.7], "dortmund": [1.3, 0.85], "psg": [1.55, 0.65],
  "psv": [1.4, 0.75], "ajax": [1.35, 0.8], "feyenoord": [1.3, 0.85],
};

function getForza(nome) {
  const n = nome.toLowerCase();
  for (const [k, v] of Object.entries(FORZA))
    if (n.includes(k) || k.includes(n.substring(0, 5))) return v;
  return [1.0, 1.0];
}

function getLambda(casa, ospite) {
  const [aC, dC] = getForza(casa);
  const [aO, dO] = getForza(ospite);
  return { lC: aC * dO * 1.45, lO: aO * dC * 1.15 };
}

// Fetch da Planetwin365
async function fetchEventi() {
  console.log("Fetching eventi da Planetwin365...");
  const browser = await puppeteer.launch(
    isLocal 
      ? { headless: true }
      : {
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath(),
          headless: chromium.headless,
        }
  );
  console.log("Browser avviato");
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0");

  let eventi = [];
  const visti = new Set();

  page.on("response", async (res) => {
    const url = res.url();
    // Log tutte le chiamate API per debug
    if (url.includes("/api/") || url.includes("Event") || url.includes("event") || url.includes("sport")) {
      console.log(`API: ${url.substring(0, 120)}`);
    }
    if (url.includes("getOverviewEventsAams") || url.includes("Event")) {
      try {
        const json = await res.json();
        console.log(`Response keys: ${Object.keys(json).join(", ")}`);
        const evList = json?.leo || json?.events || json?.data?.events || [];
        console.log(`Eventi in response: ${evList.length}`);
        for (const e of evList)
          if (e.ei && !visti.has(e.ei)) { visti.add(e.ei); eventi.push(e); }
      } catch (err) {
        console.log(`Parse error: ${err.message}`);
      }
    }
  });

  await page.goto("https://www.planetwin365.it/it/scommesse-sportive#/sport/s/1/calcio", {
    waitUntil: "networkidle2", timeout: 60000
  });
  console.log("Pagina caricata");
  
  // Screenshot debug - log HTML structure
  const pageTitle = await page.title();
  console.log(`Titolo pagina: ${pageTitle}`);
  
  // Cerca elementi menu
  const menuItems = await page.evaluate(() => {
    const items = [...document.querySelectorAll("span,div,a")].filter(e => e.innerText?.trim().length > 0 && e.innerText?.trim().length < 30);
    return items.slice(0, 20).map(e => e.innerText?.trim());
  });
  console.log(`Menu items trovati: ${menuItems.join(" | ")}`);
  
  await new Promise(r => setTimeout(r, 5000));

  const menu = [["Italia", "Serie A"], ["Italia", "Serie B"], ["Inghilterra", "Premier League"],
    ["Spagna", "Liga"], ["Germania", "Bundesliga"], ["Francia", "Ligue 1"], ["Olanda", "Eredivisie"]];

  for (const [paese, torneo] of menu) {
    try {
      console.log(`Navigando a ${paese} > ${torneo}...`);
      const clickedPaese = await page.evaluate(p => {
        const el = [...document.querySelectorAll("span,div,a")].find(e => e.innerText?.trim() === p);
        if (el) { el.click(); return true; }
        return false;
      }, paese);
      console.log(`Click ${paese}: ${clickedPaese}`);
      await new Promise(r => setTimeout(r, 2000));
      
      const clickedTorneo = await page.evaluate(t => {
        const el = [...document.querySelectorAll("span,div,a")].find(e => e.innerText?.trim() === t);
        if (el) { el.click(); return true; }
        return false;
      }, torneo);
      console.log(`Click ${torneo}: ${clickedTorneo}`);
      await new Promise(r => setTimeout(r, 2500));
    } catch (e) {
      console.log(`Errore navigazione ${paese}/${torneo}: ${e.message}`);
    }
  }

  console.log(`Trovati ${eventi.length} eventi totali`);
  await browser.close();
  return eventi;
}

function estraiQuote(ev) {
  const q = {};
  for (const m of Object.values(ev.mmkW || {})) {
    if (m.mn === "1X2") {
      const s = Object.values(m.spd || {}).flatMap(x => x.asl || []);
      q.q1 = s.find(x => x.sn === "1")?.ov;
      q.qX = s.find(x => x.sn === "X")?.ov;
      q.q2 = s.find(x => x.sn === "2")?.ov;
    }
    if (m.mn === "U/O" && m.spd?.["2.5"]) {
      const a = m.spd["2.5"].asl || [];
      q.qO = a.find(x => x.sn === "O")?.ov;
      q.qU = a.find(x => x.sn === "U")?.ov;
    }
    if (m.mn === "GG/NG") {
      const s = Object.values(m.spd || {}).flatMap(x => x.asl || []);
      q.qGG = s.find(x => x.sn === "GG")?.ov;
      q.qNG = s.find(x => x.sn === "NG")?.ov;
    }
  }
  return q;
}

async function analizza() {
  const eventi = await fetchEventi();
  const oggi = new Date().toISOString().split("T")[0];
  const top5 = new Set(["Italia | Serie A", "Inghilterra | Premier League", "Spagna | Liga", "Germania | Bundesliga", "Francia | Ligue 1"]);
  const camps = new Set(["Italia | Serie A", "Italia | Serie B", "Inghilterra | Premier League", "Spagna | Liga", "Germania | Bundesliga", "Francia | Ligue 1", "Olanda | Eredivisie"]);

  const partite = [], valueBets = [];

  for (const ev of eventi) {
    const camp = `${ev.cd} | ${ev.td}`;
    if (!camps.has(camp)) continue;
    const [g, m, a] = ev.ed.split(" ")[0].split("-");
    if (`${a}-${m}-${g}` !== oggi) continue;

    const [casa, ospite] = ev.en.split(" - ");
    const { lC, lO } = getLambda(casa, ospite);
    const r1x2 = calcola1X2(lC, lO);
    const rOU = calcolaOU(lC, lO);
    const rGG = calcolaGG(lC, lO);
    const quote = estraiQuote(ev);

    const p = {
      id: ev.ei, partita: ev.en, campionato: camp, orario: ev.ed.split(" ")[1],
      isTop5: top5.has(camp), golAttesi: [lC.toFixed(2), lO.toFixed(2)],
      modello: { p1: r1x2.p1, pX: r1x2.pX, p2: r1x2.p2, over: rOU.over, under: rOU.under, gol: rGG.gol, nogol: rGG.nogol },
      quote, valueBets: []
    };

    // Value bets
    if (quote.q1) {
      const diff1 = r1x2.p1 - 100 / quote.q1;
      const diffX = r1x2.pX - 100 / quote.qX;
      const diff2 = r1x2.p2 - 100 / quote.q2;
      if (diff1 > 5) p.valueBets.push({ t: "1", d: diff1, q: quote.q1 });
      if (diffX > 5) p.valueBets.push({ t: "X", d: diffX, q: quote.qX });
      if (diff2 > 5) p.valueBets.push({ t: "2", d: diff2, q: quote.q2 });
    }
    if (quote.qO) {
      const diffO = rOU.over - 100 / quote.qO;
      const diffU = rOU.under - 100 / quote.qU;
      if (diffO > 5) p.valueBets.push({ t: "Over", d: diffO, q: quote.qO });
      if (diffU > 5) p.valueBets.push({ t: "Under", d: diffU, q: quote.qU });
    }
    if (quote.qGG) {
      const diffGG = rGG.gol - 100 / quote.qGG;
      const diffNG = rGG.nogol - 100 / quote.qNG;
      if (diffGG > 5) p.valueBets.push({ t: "GOL", d: diffGG, q: quote.qGG });
      if (diffNG > 5) p.valueBets.push({ t: "NOGOL", d: diffNG, q: quote.qNG });
    }

    partite.push(p);
    for (const vb of p.valueBets) valueBets.push({ ...vb, partita: p.partita, camp, orario: p.orario, isTop5: p.isTop5 });
  }

  valueBets.sort((a, b) => b.d - a.d);
  return { aggiornato: new Date().toISOString(), partite, valueBets };
}

async function aggiorna() {
  try {
    cachedData = await analizza();
    lastUpdate = new Date();
    console.log(`OK: ${cachedData.partite.length} partite, ${cachedData.valueBets.length} value bets`);
  } catch (e) {
    console.error("Errore:", e.message);
  }
}

// Routes
app.get("/api/data", (req, res) => res.json(cachedData || {}));

app.get("/api/refresh", async (req, res) => {
  await aggiorna();
  res.redirect("/");
});

app.get("/", (req, res) => {
  res.send(getHTML());
});

function getHTML() {
  const d = cachedData || { partite: [], valueBets: [] };
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bet Analyzer</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:15px}
h1{color:#38bdf8;font-size:1.5em}
.upd{color:#64748b;font-size:.85em;margin:5px 0 15px}
.tabs{display:flex;gap:8px;margin-bottom:15px}
.tab{padding:8px 16px;background:#334155;border-radius:6px;cursor:pointer;font-size:.9em;transition:all .2s}
.tab:hover{background:#475569;transform:translateY(-1px)}
.tab.active{background:#3b82f6}
.tab.active:hover{background:#2563eb}
.card{background:#1e293b;border-radius:10px;padding:15px;margin-bottom:15px}
.card h2{color:#f59e0b;font-size:1.1em;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:.85em}
th,td{padding:6px;text-align:left;border-bottom:1px solid #334155}
th{color:#94a3b8}
.top5{border-left:3px solid #f59e0b}
.val{color:#22c55e;font-weight:bold}
.q{color:#38bdf8}
.btn{background:#3b82f6;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin-top:10px;font-size:.9em;transition:all .2s}
.btn:hover{background:#2563eb;transform:translateY(-1px);box-shadow:0 4px 12px rgba(59,130,246,.4)}
.btn:active{transform:translateY(0)}
.hide{display:none}
.sch{background:#1e3a5f;border-radius:8px;padding:12px;margin-bottom:10px}
.sch-q{font-size:1.3em;color:#22c55e;float:right}
.row{padding:6px 0;border-bottom:1px solid #334155}
.row:last-child{border-bottom:none}
.sm{color:#94a3b8;font-size:.8em}
.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:.7em;margin-left:4px;background:#f59e0b;color:#000}
</style></head><body>
<h1>🎯 Bet Analyzer</h1>
<p class="upd">Agg: ${d.aggiornato ? new Date(d.aggiornato).toLocaleString("it") : "-"} | ${d.partite.length} partite</p>
<div class="tabs">
<div class="tab active" onclick="show(0)">💎 Value (${d.valueBets.length})</div>
<div class="tab" onclick="show(1)">⚽ Partite</div>
</div>
<div id="t0" class="card">
<h2>💎 Value Bets</h2>
${d.valueBets.length ? `<table><tr><th>Partita</th><th>Tipo</th><th>Quota</th><th>Value</th></tr>
${d.valueBets.slice(0, 15).map(v => `<tr class="${v.isTop5 ? "top5" : ""}"><td>${v.partita}<br><span class="sm">${v.camp}</span></td><td>${v.t}</td><td class="q">@${v.q?.toFixed(2)}</td><td class="val">+${v.d?.toFixed(1)}%</td></tr>`).join("")}</table>` : "<p>Nessun value bet</p>"}
</div>
<div id="t1" class="card hide">
<h2>⚽ Partite Oggi</h2>
<table><tr><th>Partita</th><th>λ</th><th>1X2</th><th>O/U</th></tr>
${d.partite.map(p => `<tr class="${p.isTop5 ? "top5" : ""}"><td>${p.partita}${p.isTop5 ? '<span class="badge">TOP5</span>' : ""}<br><span class="sm">${p.campionato}</span></td><td>${p.golAttesi[0]}-${p.golAttesi[1]}</td><td>${p.modello.p1?.toFixed(0)}/${p.modello.pX?.toFixed(0)}/${p.modello.p2?.toFixed(0)}</td><td>${p.modello.over?.toFixed(0)}/${p.modello.under?.toFixed(0)}</td></tr>`).join("")}</table>
</div>
<button class="btn" onclick="location.href='/api/refresh'">🔄 Aggiorna Dati</button>
<script>
function show(i){document.querySelectorAll('.card').forEach((c,j)=>{c.classList.toggle('hide',i!==j)});document.querySelectorAll('.tab').forEach((t,j)=>{t.classList.toggle('active',i===j)})}
</script></body></html>`;
}

// Start
aggiorna().then(() => {
  app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
});
setInterval(aggiorna, 15 * 60 * 1000);
