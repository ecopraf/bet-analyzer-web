const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ODDS_API_KEYS = [
  "8bd3b61169f49c3fad0882858a7f7e2c",
  "4e7832401d5cf057776e63db2fced411",
  "84ab684569c2387945bda6b23cc16e1d",
  "f4dc183f73651f7c16ce8156003ea00d"
];
let currentKeyIndex = 0;

function getNextApiKey() {
  const key = ODDS_API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % ODDS_API_KEYS.length;
  return key;
}

const CACHE_DIR = path.join(__dirname, "cache");

let cachedData = null;
let lastUpdate = null;
let server = null;
let teamStats = {};
let apiCallsToday = 0;
let apiCallsDate = new Date().toISOString().split("T")[0];

// Crea cartella cache se non esiste
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nChiusura in corso...');
  if (server) server.close();
  process.exit(0);
});

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

// URLs per dati storici Football-Data.co.uk
const HISTORICAL_URLS = {
  "soccer_italy_serie_a": "https://www.football-data.co.uk/mmz4281/2526/I1.csv",
  "soccer_italy_serie_b": "https://www.football-data.co.uk/mmz4281/2526/I2.csv",
  "soccer_epl": "https://www.football-data.co.uk/mmz4281/2526/E0.csv",
  "soccer_spain_la_liga": "https://www.football-data.co.uk/mmz4281/2526/SP1.csv",
  "soccer_germany_bundesliga": "https://www.football-data.co.uk/mmz4281/2526/D1.csv",
  "soccer_france_ligue_one": "https://www.football-data.co.uk/mmz4281/2526/F1.csv",
  "soccer_netherlands_eredivisie": "https://www.football-data.co.uk/mmz4281/2526/N1.csv",
  "soccer_portugal_primeira_liga": "https://www.football-data.co.uk/mmz4281/2526/P1.csv",
  "soccer_turkey_super_league": "https://www.football-data.co.uk/mmz4281/2526/T1.csv",
  "soccer_greece_super_league": "https://www.football-data.co.uk/mmz4281/2526/G1.csv",
};

// Carica dati storici da Football-Data.co.uk
async function loadHistoricalData() {
  console.log("Caricamento dati storici...");
  const stats = {};
  
  for (const [league, url] of Object.entries(HISTORICAL_URLS)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const csv = await res.text();
      const lines = csv.split("\n").slice(1); // Skip header
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",");
        const homeTeam = cols[3]?.trim();
        const awayTeam = cols[4]?.trim();
        const homeGoals = parseInt(cols[5]);
        const awayGoals = parseInt(cols[6]);
        
        if (!homeTeam || !awayTeam || isNaN(homeGoals) || isNaN(awayGoals)) continue;
        
        // Inizializza stats
        if (!stats[homeTeam]) stats[homeTeam] = { gf: 0, gs: 0, matches: 0, gfHome: 0, gsHome: 0, matchesHome: 0 };
        if (!stats[awayTeam]) stats[awayTeam] = { gf: 0, gs: 0, matches: 0, gfAway: 0, gsAway: 0, matchesAway: 0 };
        
        // Aggiorna stats casa
        stats[homeTeam].gf += homeGoals;
        stats[homeTeam].gs += awayGoals;
        stats[homeTeam].matches++;
        stats[homeTeam].gfHome = (stats[homeTeam].gfHome || 0) + homeGoals;
        stats[homeTeam].gsHome = (stats[homeTeam].gsHome || 0) + awayGoals;
        stats[homeTeam].matchesHome = (stats[homeTeam].matchesHome || 0) + 1;
        
        // Aggiorna stats trasferta
        stats[awayTeam].gf += awayGoals;
        stats[awayTeam].gs += homeGoals;
        stats[awayTeam].matches++;
        stats[awayTeam].gfAway = (stats[awayTeam].gfAway || 0) + awayGoals;
        stats[awayTeam].gsAway = (stats[awayTeam].gsAway || 0) + homeGoals;
        stats[awayTeam].matchesAway = (stats[awayTeam].matchesAway || 0) + 1;
      }
      console.log(`${league}: caricato`);
    } catch (e) {
      console.log(`Errore ${league}: ${e.message}`);
    }
  }
  
  // Carica anche risultati recenti da The Odds API
  await loadRecentResults(stats);
  
  return stats;
}

// Carica risultati recenti da The Odds API (usa key a rotazione)
async function loadRecentResults(stats) {
  console.log("Caricamento risultati recenti...");
  for (const league of LEAGUES) {
    try {
      const apiKey = getNextApiKey();
      const url = `https://api.the-odds-api.com/v4/sports/${league.key}/scores/?apiKey=${apiKey}&daysFrom=3`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      
      for (const match of data) {
        if (!match.completed || !match.scores) continue;
        
        const homeTeam = match.home_team;
        const awayTeam = match.away_team;
        const homeScore = match.scores.find(s => s.name === homeTeam);
        const awayScore = match.scores.find(s => s.name === awayTeam);
        
        if (!homeScore || !awayScore) continue;
        const homeGoals = parseInt(homeScore.score);
        const awayGoals = parseInt(awayScore.score);
        
        // Inizializza e aggiorna stats
        if (!stats[homeTeam]) stats[homeTeam] = { gf: 0, gs: 0, matches: 0 };
        if (!stats[awayTeam]) stats[awayTeam] = { gf: 0, gs: 0, matches: 0 };
        
        stats[homeTeam].gf += homeGoals;
        stats[homeTeam].gs += awayGoals;
        stats[homeTeam].matches++;
        
        stats[awayTeam].gf += awayGoals;
        stats[awayTeam].gs += homeGoals;
        stats[awayTeam].matches++;
      }
    } catch (e) {
      console.log(`Errore risultati ${league.key}: ${e.message}`);
    }
  }
}

// Normalizza nome squadra per matching
function normalizeTeamName(name) {
  return name.toLowerCase()
    .replace(/^ac /i, "").replace(/ fc$/i, "").replace(/ bc$/i, "")
    .replace("milan", "milan").replace("inter milan", "inter")
    .replace("as roma", "roma").replace("atalanta bc", "atalanta")
    .trim();
}

// Trova stats squadra
function findTeamStats(teamName) {
  const normalized = normalizeTeamName(teamName);
  
  // Cerca match esatto o parziale
  for (const [name, stats] of Object.entries(teamStats)) {
    const normName = normalizeTeamName(name);
    if (normName === normalized || normName.includes(normalized) || normalized.includes(normName)) {
      return stats;
    }
  }
  return null;
}

// Calcola lambda basato su dati reali
function getLambda(casa, ospite) {
  const statsCasa = findTeamStats(casa);
  const statsOspite = findTeamStats(ospite);
  
  // Media gol campionato (fallback)
  const avgGoals = 1.35;
  
  let attCasa = avgGoals, difCasa = avgGoals;
  let attOspite = avgGoals, difOspite = avgGoals;
  
  if (statsCasa && statsCasa.matches >= 3) {
    attCasa = statsCasa.gf / statsCasa.matches;
    difCasa = statsCasa.gs / statsCasa.matches;
  }
  
  if (statsOspite && statsOspite.matches >= 3) {
    attOspite = statsOspite.gf / statsOspite.matches;
    difOspite = statsOspite.gs / statsOspite.matches;
  }
  
  // Lambda = (attacco squadra * difesa avversario) / media campionato * fattore casa/trasferta
  const lC = (attCasa * difOspite / avgGoals) * 1.1; // +10% casa
  const lO = (attOspite * difCasa / avgGoals) * 0.9; // -10% trasferta
  
  return { 
    lC: Math.max(0.5, Math.min(3.5, lC)), 
    lO: Math.max(0.3, Math.min(3.0, lO)),
    hasData: !!(statsCasa && statsOspite)
  };
}

// Fetch da The Odds API
const LEAGUES = [
  { key: "soccer_italy_serie_a", name: "Italia | Serie A", isTop5: true, flag: "🇮🇹" },
  { key: "soccer_italy_serie_b", name: "Italia | Serie B", isTop5: false, flag: "🇮🇹" },
  { key: "soccer_epl", name: "Inghilterra | Premier League", isTop5: true, flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { key: "soccer_spain_la_liga", name: "Spagna | Liga", isTop5: true, flag: "🇪🇸" },
  { key: "soccer_germany_bundesliga", name: "Germania | Bundesliga", isTop5: true, flag: "🇩🇪" },
  { key: "soccer_france_ligue_one", name: "Francia | Ligue 1", isTop5: true, flag: "🇫🇷" },
  { key: "soccer_netherlands_eredivisie", name: "Olanda | Eredivisie", isTop5: false, flag: "🇳🇱" },
  { key: "soccer_portugal_primeira_liga", name: "Portogallo | Primeira Liga", isTop5: false, flag: "🇵🇹" },
  { key: "soccer_turkey_super_league", name: "Turchia | Super Lig", isTop5: false, flag: "🇹🇷" },
  { key: "soccer_greece_super_league", name: "Grecia | Super League", isTop5: false, flag: "🇬🇷" },
];

// Mappa campionato -> bandiera
const LEAGUE_FLAGS = {
  "Italia | Serie A": "🇮🇹",
  "Italia | Serie B": "🇮🇹",
  "Inghilterra | Premier League": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Spagna | Liga": "🇪🇸",
  "Germania | Bundesliga": "🇩🇪",
  "Francia | Ligue 1": "🇫🇷",
  "Olanda | Eredivisie": "🇳🇱",
  "Portogallo | Primeira Liga": "🇵🇹",
  "Turchia | Super Lig": "🇹🇷",
  "Grecia | Super League": "🇬🇷",
};

function getFlag(campionato) {
  return LEAGUE_FLAGS[campionato] || "⚽";
}

async function fetchEventi(forceRefresh = false) {
  // Calcola settimana corrente (ISO week)
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  const weekKey = `${now.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
  const cacheFile = path.join(CACHE_DIR, `quotes_week_${weekKey}.json`);
  
  // Reset contatore se giorno nuovo
  const oggi = now.toISOString().split("T")[0];
  if (apiCallsDate !== oggi) {
    apiCallsDate = oggi;
    apiCallsToday = 0;
  }
  
  // Usa cache settimanale se esiste e non forziamo refresh
  if (!forceRefresh && fs.existsSync(cacheFile)) {
    console.log(`Caricamento quote da cache settimanale: ${cacheFile}`);
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    console.log(`Cache: ${cached.eventi.length} eventi, settimana ${weekKey}, salvato ${cached.timestamp}`);
    return cached.eventi;
  }
  
  console.log(`Fetching eventi da The Odds API (settimana ${weekKey})...`);
  const eventi = [];
  
  for (const league of LEAGUES) {
    try {
      const apiKey = getNextApiKey();
      const url = `https://api.the-odds-api.com/v4/sports/${league.key}/odds/?apiKey=${apiKey}&regions=eu&markets=h2h,totals,btts,spreads,double_chance&oddsFormat=decimal`;
      const res = await fetch(url);
      apiCallsToday++;
      
      if (!res.ok) {
        console.log(`Errore ${league.key}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      console.log(`${league.name}: ${data.length} partite`);
      
      for (const match of data) {
        eventi.push({ ...match, leagueName: league.name, isTop5: league.isTop5 });
      }
    } catch (e) {
      console.log(`Errore fetch ${league.key}: ${e.message}`);
    }
  }
  
  console.log(`Totale: ${eventi.length} eventi | API calls oggi: ${apiCallsToday}`);
  
  // Salva in cache settimanale
  const now2 = new Date();
  const startOfYear2 = new Date(now2.getFullYear(), 0, 1);
  const weekNum2 = Math.ceil(((now2 - startOfYear2) / 86400000 + startOfYear2.getDay() + 1) / 7);
  const weekKey2 = `${now2.getFullYear()}-W${weekNum2.toString().padStart(2, '0')}`;
  const cacheFile2 = path.join(CACHE_DIR, `quotes_week_${weekKey2}.json`);
  
  fs.writeFileSync(cacheFile2, JSON.stringify({
    timestamp: new Date().toISOString(),
    week: weekKey2,
    apiCalls: apiCallsToday,
    eventi
  }, null, 2));
  console.log(`Cache settimanale salvata: ${cacheFile2}`);
  
  return eventi;
}

function estraiQuote(ev) {
  const q = {};
  const bookmaker = ev.bookmakers?.[0];
  if (!bookmaker) return q;
  
  for (const market of bookmaker.markets || []) {
    if (market.key === "h2h") {
      const outcomes = market.outcomes || [];
      q.q1 = outcomes.find(o => o.name === ev.home_team)?.price;
      q.q2 = outcomes.find(o => o.name === ev.away_team)?.price;
      q.qX = outcomes.find(o => o.name === "Draw")?.price;
    }
    if (market.key === "totals") {
      const outcomes = market.outcomes || [];
      q.qO = outcomes.find(o => o.name === "Over")?.price;
      q.qU = outcomes.find(o => o.name === "Under")?.price;
    }
  }
  // Cerca quote GG/NG da btts market se disponibile
  for (const bm of ev.bookmakers || []) {
    const btts = bm.markets?.find(m => m.key === "btts");
    if (btts) {
      q.qGG = btts.outcomes?.find(o => o.name === "Yes")?.price;
      q.qNG = btts.outcomes?.find(o => o.name === "No")?.price;
      break;
    }
  }
  // Cerca spreads (handicap)
  for (const bm of ev.bookmakers || []) {
    const spreads = bm.markets?.find(m => m.key === "spreads");
    if (spreads) {
      const homeSpread = spreads.outcomes?.find(o => o.name === ev.home_team);
      const awaySpread = spreads.outcomes?.find(o => o.name === ev.away_team);
      if (homeSpread) { q.spreadHome = homeSpread.point; q.qSpreadHome = homeSpread.price; }
      if (awaySpread) { q.spreadAway = awaySpread.point; q.qSpreadAway = awaySpread.price; }
      break;
    }
  }
  // Cerca double chance
  for (const bm of ev.bookmakers || []) {
    const dc = bm.markets?.find(m => m.key === "double_chance");
    if (dc) {
      q.q1X = dc.outcomes?.find(o => o.name === "Home or Draw" || o.name === ev.home_team + " or Draw")?.price;
      q.q12 = dc.outcomes?.find(o => o.name === "Home or Away" || o.name === ev.home_team + " or " + ev.away_team)?.price;
      q.qX2 = dc.outcomes?.find(o => o.name === "Draw or Away" || o.name === "Draw or " + ev.away_team)?.price;
      break;
    }
  }
  return q;
}

// Analizza partita e suggerisce la migliore giocata
function analizzaPartita(p, lC, lO) {
  const dominated = [];
  const dominated_neg = [];
  const q = p.quote;
  const m = p.modello;
  
  // Analizza ogni mercato
  if (q.q1) {
    const probBook = 100 / q.q1;
    const value = m.p1 - probBook;
    dominated.push({ tipo: "1", nome: p.partita.split(" - ")[0], prob: m.p1, quota: q.q1, probBook, value });
  }
  if (q.qX) {
    const probBook = 100 / q.qX;
    const value = m.pX - probBook;
    dominated.push({ tipo: "X", nome: "Pareggio", prob: m.pX, quota: q.qX, probBook, value });
  }
  if (q.q2) {
    const probBook = 100 / q.q2;
    const value = m.p2 - probBook;
    dominated.push({ tipo: "2", nome: p.partita.split(" - ")[1], prob: m.p2, quota: q.q2, probBook, value });
  }
  if (q.qO) {
    const probBook = 100 / q.qO;
    const value = m.over - probBook;
    dominated.push({ tipo: "Over 2.5", nome: "Over 2.5", prob: m.over, quota: q.qO, probBook, value });
  }
  if (q.qU) {
    const probBook = 100 / q.qU;
    const value = m.under - probBook;
    dominated.push({ tipo: "Under 2.5", nome: "Under 2.5", prob: m.under, quota: q.qU, probBook, value });
  }
  if (q.qGG) {
    const probBook = 100 / q.qGG;
    const value = m.gol - probBook;
    dominated.push({ tipo: "GG", nome: "Gol", prob: m.gol, quota: q.qGG, probBook, value });
  }
  if (q.qNG) {
    const probBook = 100 / q.qNG;
    const value = m.nogol - probBook;
    dominated.push({ tipo: "NG", nome: "No Gol", prob: m.nogol, quota: q.qNG, probBook, value });
  }
  // Double chance (prob approssimata)
  if (q.q1X) {
    const prob1X = m.p1 + m.pX;
    const probBook = 100 / q.q1X;
    dominated.push({ tipo: "1X", nome: "Casa o Pareggio", prob: prob1X, quota: q.q1X, probBook, value: prob1X - probBook, isExtra: true });
  }
  if (q.qX2) {
    const probX2 = m.pX + m.p2;
    const probBook = 100 / q.qX2;
    dominated.push({ tipo: "X2", nome: "Pareggio o Ospite", prob: probX2, quota: q.qX2, probBook, value: probX2 - probBook, isExtra: true });
  }
  if (q.q12) {
    const prob12 = m.p1 + m.p2;
    const probBook = 100 / q.q12;
    dominated.push({ tipo: "12", nome: "Casa o Ospite", prob: prob12, quota: q.q12, probBook, value: prob12 - probBook, isExtra: true });
  }
  // Handicap
  if (q.qSpreadHome && q.spreadHome) {
    dominated.push({ tipo: `H${q.spreadHome > 0 ? '+' : ''}${q.spreadHome}`, nome: `Handicap Casa ${q.spreadHome}`, prob: null, quota: q.qSpreadHome, probBook: 100/q.qSpreadHome, value: 0, isExtra: true, isHandicap: true });
  }
  if (q.qSpreadAway && q.spreadAway) {
    dominated.push({ tipo: `H${q.spreadAway > 0 ? '+' : ''}${q.spreadAway}`, nome: `Handicap Ospite ${q.spreadAway}`, prob: null, quota: q.qSpreadAway, probBook: 100/q.qSpreadAway, value: 0, isExtra: true, isHandicap: true });
  }
  
  // Ordina per value
  dominated.sort((a, b) => b.value - a.value);
  
  // Trova il miglior suggerimento basato su modello Poisson
  const totGolAttesi = lC + lO;
  
  // Prima cerca con value, poi senza
  const conValue = dominated.find(d => {
    if (d.isExtra) return false;
    if (d.value < 2) return false;
    switch(d.tipo) {
      case '1': case '2': return d.prob >= 55;
      case 'X': return d.prob >= 28 && d.value >= 3;
      case 'Over 2.5': return d.prob >= 55 && totGolAttesi >= 2.5;
      case 'Under 2.5': return d.prob >= 55 && totGolAttesi < 2.5;
      case 'GG': return d.prob >= 55 && lC >= 1.0 && lO >= 1.0;
      case 'NG': return d.prob >= 55 && (lC < 1.0 || lO < 1.0);
      default: return false;
    }
  });
  
  // Se non c'è value, cerca comunque la migliore per probabilità
  const senzaValue = !conValue ? dominated.find(d => {
    if (d.isExtra) return false;
    switch(d.tipo) {
      case '1': case '2': return d.prob >= 55;
      case 'X': return d.prob >= 30;
      case 'Over 2.5': return d.prob >= 55 && totGolAttesi >= 2.5;
      case 'Under 2.5': return d.prob >= 55 && totGolAttesi < 2.5;
      case 'GG': return d.prob >= 55 && lC >= 1.0 && lO >= 1.0;
      case 'NG': return d.prob >= 55 && (lC < 1.0 || lO < 1.0);
      default: return false;
    }
  }) : null;
  
  const migliore = conValue || senzaValue;
  if (migliore) migliore.hasValue = !!conValue;
  
  return { analisi: dominated, suggerimento: migliore };
}

async function analizza(forceRefresh = false) {
  const eventi = await fetchEventi(forceRefresh);
  const partite = [], valueBets = [];
  const now = Date.now();

  for (const ev of eventi) {
    // Salta partite già iniziate
    const matchTime = new Date(ev.commence_time).getTime();
    if (matchTime < now) continue;
    const casa = ev.home_team;
    const ospite = ev.away_team;
    const { lC, lO, hasData } = getLambda(casa, ospite);
    const r1x2 = calcola1X2(lC, lO);
    const rOU = calcolaOU(lC, lO);
    const rGG = calcolaGG(lC, lO);
    const quote = estraiQuote(ev);
    
    const dataOra = new Date(ev.commence_time);
    const orario = dataOra.toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    const data = dataOra.toISOString().split("T")[0]; // YYYY-MM-DD per filtro
    const timestamp = dataOra.getTime(); // Per ordinamento

    const p = {
      id: ev.id, partita: `${casa} - ${ospite}`, campionato: ev.leagueName, orario, data, timestamp,
      isTop5: ev.isTop5, hasData, golAttesi: [lC.toFixed(2), lO.toFixed(2)],
      modello: { p1: r1x2.p1, pX: r1x2.pX, p2: r1x2.p2, over: rOU.over, under: rOU.under, gol: rGG.gol, nogol: rGG.nogol },
      quote, valueBets: []
    };
    
    // Analisi completa e suggerimento
    const { analisi, suggerimento } = analizzaPartita(p, lC, lO);
    p.analisi = analisi;
    p.suggerimento = suggerimento;

    // Value bets - solo pronostici realistici
    if (quote.q1 && quote.qX && quote.q2) {
      const pBook1 = 100 / quote.q1;
      const pBook2 = 100 / quote.q2;
      const diff1 = r1x2.p1 - pBook1;
      const diff2 = r1x2.p2 - pBook2;
      
      // Filtro: se quota > 3.00 ma modello dice > 50%, è un errore del modello (ignora)
      // Value realistico: diff tra 3% e 20%, prob > 50%, quota < 3.50
      if (diff1 > 3 && diff1 < 30 && r1x2.p1 > 50 && quote.q1 < 3.50) p.valueBets.push({ t: "1", d: diff1, q: quote.q1, prob: r1x2.p1 });
      if (diff2 > 3 && diff2 < 30 && r1x2.p2 > 50 && quote.q2 < 3.50) p.valueBets.push({ t: "2", d: diff2, q: quote.q2, prob: r1x2.p2 });
    }
    if (quote.qO && quote.qU) {
      const diffO = rOU.over - 100 / quote.qO;
      const diffU = rOU.under - 100 / quote.qU;
      if (diffO > 3 && diffO < 30 && rOU.over > 50) p.valueBets.push({ t: "Over 2.5", d: diffO, q: quote.qO, prob: rOU.over });
      if (diffU > 3 && diffU < 30 && rOU.under > 50) p.valueBets.push({ t: "Under 2.5", d: diffU, q: quote.qU, prob: rOU.under });
    }
    if (quote.qGG && quote.qNG) {
      const diffGG = rGG.gol - 100 / quote.qGG;
      const diffNG = rGG.nogol - 100 / quote.qNG;
      if (diffGG > 3 && diffGG < 30 && rGG.gol > 50) p.valueBets.push({ t: "GG", d: diffGG, q: quote.qGG, prob: rGG.gol });
      if (diffNG > 3 && diffNG < 30 && rGG.nogol > 50) p.valueBets.push({ t: "NG", d: diffNG, q: quote.qNG, prob: rGG.nogol });
    }

    partite.push(p);
    for (const vb of p.valueBets) valueBets.push({ ...vb, partita: p.partita, camp: ev.leagueName, orario: p.orario, data: p.data, timestamp: p.timestamp, isTop5: p.isTop5 });
  }

  // Ordina per data/ora
  partite.sort((a, b) => a.timestamp - b.timestamp);
  valueBets.sort((a, b) => {
    // Prima per data (più vicina prima)
    if (a.data !== b.data) return a.data.localeCompare(b.data);
    // Poi per campionato
    if (a.camp !== b.camp) return a.camp.localeCompare(b.camp);
    // Poi per value (più alto prima)
    return b.d - a.d;
  });
  
  // Estrai date uniche per filtri
  const dateUniche = [...new Set(partite.map(p => p.data))].sort();
  const campionatiUnici = [...new Set(partite.map(p => p.campionato))].sort();
  
  // Genera schedine consigliate
  const schedine = generaSchedine(valueBets, partite);
  const schedinaGol = generaSchedinaGol(partite);
  
  return { aggiornato: new Date().toISOString(), partite, valueBets, dateUniche, campionatiUnici, schedine, schedinaGol };
}

function generaSchedine(valueBets, partite) {
  const schedine = [];
  const oggi = new Date().toISOString().split('T')[0];
  
  // Filtra solo partite di oggi
  const valueBetsOggi = valueBets.filter(v => v.data === oggi);
  const partiteOggi = partite.filter(p => p.data === oggi);
  
  // 🎯 Schedina Raddoppio: aggiungi eventi sicuri finché quota >= 2 (max 3)
  const sicure = valueBetsOggi.filter(v => v.prob >= 55 && v.d >= 3).sort((a,b) => (b.prob + b.d) - (a.prob + a.d));
  let raddoppio = [];
  let quotaRaddoppio = 1;
  for (const s of sicure) {
    if (quotaRaddoppio >= 2 || raddoppio.length >= 3) break;
    raddoppio.push(s);
    quotaRaddoppio *= s.q;
  }
  if (raddoppio.length >= 1 && quotaRaddoppio >= 2) {
    schedine.push({ nome: "🎯 Raddoppio", tipo: "Quota ≥2 sicura", scommesse: raddoppio, quotaTot: quotaRaddoppio });
  }
  
  // ⚽ Schedina Mista Gol/Over: max 5-6 eventi, quota min 1.45, value + prob alta
  const golOver = partiteOggi.filter(p => {
    const ggOk = p.modello.gol >= 55 && p.quote.qGG >= 1.45;
    const overOk = p.modello.over >= 55 && p.quote.qO >= 1.45;
    return ggOk || overOk;
  }).map(p => {
    // Scegli il migliore tra GG e Over per questa partita
    const ggValue = p.modello.gol - (p.quote.qGG ? 100/p.quote.qGG : 100);
    const overValue = p.modello.over - (p.quote.qO ? 100/p.quote.qO : 100);
    const ggOk = p.modello.gol >= 55 && p.quote.qGG >= 1.45;
    const overOk = p.modello.over >= 55 && p.quote.qO >= 1.45;
    
    if (ggOk && overOk) {
      return ggValue > overValue 
        ? { t: 'GG', q: p.quote.qGG, prob: p.modello.gol, d: ggValue, partita: p.partita, camp: p.campionato, orario: p.orario }
        : { t: 'Over 2.5', q: p.quote.qO, prob: p.modello.over, d: overValue, partita: p.partita, camp: p.campionato, orario: p.orario };
    }
    if (ggOk) return { t: 'GG', q: p.quote.qGG, prob: p.modello.gol, d: ggValue, partita: p.partita, camp: p.campionato, orario: p.orario };
    if (overOk) return { t: 'Over 2.5', q: p.quote.qO, prob: p.modello.over, d: overValue, partita: p.partita, camp: p.campionato, orario: p.orario };
    return null;
  }).filter(Boolean).sort((a,b) => (b.prob + b.d) - (a.prob + a.d)).slice(0, 6);
  
  if (golOver.length >= 3) {
    schedine.push({ nome: "⚽ Mista Gol/Over", tipo: "GG + Over 2.5 value", scommesse: golOver, quotaTot: golOver.reduce((acc, v) => acc * v.q, 1) });
  }
  
  return schedine;
}

function generaSchedinaGol(partite) {
  const oggi = new Date().toISOString().split('T')[0];
  const partiteOggi = partite.filter(p => p.data === oggi);
  
  const golSicuri = partiteOggi.filter(p => p.modello.gol > 55 && p.quote.qGG).sort((a, b) => b.modello.gol - a.modello.gol).slice(0, 3)
    .map(p => ({ partita: p.partita, camp: p.campionato, orario: p.orario, t: "GG", prob: p.modello.gol, q: p.quote.qGG || 1.75 }));
  const noGolSicuri = partiteOggi.filter(p => p.modello.nogol > 60 && p.quote.qNG).sort((a, b) => b.modello.nogol - a.modello.nogol).slice(0, 2)
    .map(p => ({ partita: p.partita, camp: p.campionato, orario: p.orario, t: "NG", prob: p.modello.nogol, q: p.quote.qNG || 1.65 }));
  
  const scommesse = [...golSicuri, ...noGolSicuri].slice(0, 4);
  if (scommesse.length < 2) return null;
  
  return { nome: "⚽ Schedina Gol", tipo: "GG/NG combinati", scommesse, quotaTot: scommesse.reduce((acc, v) => acc * v.q, 1) };
}

async function aggiorna(forceRefresh = false) {
  try {
    cachedData = await analizza(forceRefresh);
    cachedData.apiCallsToday = apiCallsToday;
    lastUpdate = new Date();
    console.log(`OK: ${cachedData.partite.length} partite, ${cachedData.valueBets.length} value bets | API calls: ${apiCallsToday}`);
  } catch (e) {
    console.error("Errore:", e.message);
  }
}

// Routes
app.get("/api/data", (req, res) => res.json(cachedData || {}));

app.get("/api/refresh", async (req, res) => {
  await aggiorna(true); // forza refresh da API
  res.redirect("/");
});

app.get("/api/cache-refresh", async (req, res) => {
  await aggiorna(false); // usa cache se disponibile
  res.redirect("/");
});

// Verifica risultati schedina
app.post("/api/verifica-schedina", express.json(), async (req, res) => {
  const { partite } = req.body;
  if (!partite || !partite.length) return res.json({ risultati: [] });
  
  const risultati = [];
  const legheUniche = new Set();
  
  // Trova le leghe delle partite da verificare
  for (const p of partite) {
    // Cerca la lega dalla cache
    const cached = cachedData?.partite?.find(cp => cp.id === p.id);
    if (cached) {
      const leagueKey = LEAGUES.find(l => l.name === cached.campionato)?.key;
      if (leagueKey) legheUniche.add(leagueKey);
    }
  }
  
  // Fetch risultati per ogni lega
  const scores = {};
  for (const leagueKey of legheUniche) {
    try {
      const apiKey = getNextApiKey();
      const url = `https://api.the-odds-api.com/v4/sports/${leagueKey}/scores/?apiKey=${apiKey}&daysFrom=3`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        for (const match of data) {
          scores[match.id] = match;
        }
      }
    } catch (e) {
      console.log(`Errore fetch scores ${leagueKey}: ${e.message}`);
    }
  }
  
  // Verifica ogni partita della schedina
  for (const p of partite) {
    const match = scores[p.id];
    let stato = 'incorso';
    
    if (match && match.completed && match.scores) {
      const homeScore = parseInt(match.scores.find(s => s.name === match.home_team)?.score || 0);
      const awayScore = parseInt(match.scores.find(s => s.name === match.away_team)?.score || 0);
      const totGol = homeScore + awayScore;
      const ggResult = homeScore > 0 && awayScore > 0;
      
      // Determina risultato 1X2
      let risultato1X2 = 'X';
      if (homeScore > awayScore) risultato1X2 = '1';
      else if (awayScore > homeScore) risultato1X2 = '2';
      
      // Verifica esito scommessa
      const esito = p.esito;
      if (esito === '1') stato = risultato1X2 === '1' ? 'vinto' : 'perso';
      else if (esito === 'X') stato = risultato1X2 === 'X' ? 'vinto' : 'perso';
      else if (esito === '2') stato = risultato1X2 === '2' ? 'vinto' : 'perso';
      else if (esito === 'Over 2.5') stato = totGol > 2.5 ? 'vinto' : 'perso';
      else if (esito === 'Under 2.5') stato = totGol < 2.5 ? 'vinto' : 'perso';
      else if (esito === 'GG') stato = ggResult ? 'vinto' : 'perso';
      else if (esito === 'NG') stato = !ggResult ? 'vinto' : 'perso';
    }
    
    risultati.push({ id: p.id, stato, match });
  }
  
  res.json({ risultati });
});

app.get("/api/risultati", async (req, res) => {
  const scores = [];
  for (const league of LEAGUES) {
    try {
      const apiKey = getNextApiKey();
      const url = `https://api.the-odds-api.com/v4/sports/${league.key}/scores/?apiKey=${apiKey}&daysFrom=2`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        for (const match of data) {
          if (match.completed) {
            scores.push({ ...match, league: league.name, flag: league.flag });
          }
        }
      }
    } catch (e) {
      console.log(`Errore risultati ${league.key}: ${e.message}`);
    }
  }
  scores.sort((a, b) => new Date(b.commence_time) - new Date(a.commence_time));
  res.json({ scores, timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.send(getHTML());
});

function getHTML() {
  const d = cachedData || { partite: [], valueBets: [] };
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bet Analyzer</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎯</text></svg>">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:15px;padding-bottom:180px}
h1{color:#38bdf8;font-size:1.5em}
.upd{color:#64748b;font-size:.85em;margin:5px 0 15px}
.tabs{display:flex;gap:8px;margin-bottom:15px}
.tab{padding:8px 16px;background:#334155;border-radius:6px;cursor:pointer;font-size:.9em;transition:all .2s}
.tab:hover{background:#475569;transform:translateY(-1px)}
.tab.active{background:#3b82f6}
.tab.active:hover{background:#2563eb}
.card{background:#1e293b;border-radius:10px;padding:15px;margin-bottom:15px}
.card h2{color:#f59e0b;font-size:1.1em;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:.85em;table-layout:fixed}
th,td{padding:6px;text-align:left;border-bottom:1px solid #334155;overflow:hidden;text-overflow:ellipsis}
#t0 table th:nth-child(1),#t0 table td:nth-child(1){width:40%}
#t0 table th:nth-child(2),#t0 table td:nth-child(2){width:10%}
#t0 table th:nth-child(3),#t0 table td:nth-child(3){width:12%}
#t0 table th:nth-child(4),#t0 table td:nth-child(4){width:12%}
#t0 table th:nth-child(5),#t0 table td:nth-child(5){width:12%}
#t0 table th:nth-child(6),#t0 table td:nth-child(6){width:14%}
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
.filters{margin-bottom:15px;display:flex;gap:10px;flex-wrap:wrap}
.filters select{padding:8px;border-radius:6px;background:#334155;color:#e2e8f0;border:none}
.mia-schedina{position:fixed;bottom:0;left:0;right:0;background:#1e293b;border-top:2px solid #3b82f6;padding:12px 15px;z-index:100;display:none}
.mia-schedina.active{display:block}
.mia-schedina h3{color:#3b82f6;font-size:1em;margin-bottom:8px}
.mia-schedina-list{max-height:120px;overflow-y:auto;margin-bottom:8px}
.mia-schedina-item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #334155;font-size:.85em}
.mia-schedina-item .remove{color:#ef4444;cursor:pointer;margin-left:8px}
.mia-schedina-footer{display:flex;align-items:center;gap:15px;flex-wrap:wrap}
.mia-schedina-footer input{width:70px;padding:6px;border-radius:4px;border:none;background:#334155;color:#e2e8f0;text-align:center}
.mia-schedina-footer .quota-tot{color:#22c55e;font-size:1.2em;font-weight:bold}
.mia-schedina-footer .vincita{color:#f59e0b;font-size:1.1em}
.esito-btn{padding:4px 8px;margin:2px;border-radius:4px;border:none;cursor:pointer;font-size:.75em;background:#475569;color:#e2e8f0;transition:all .2s}
.esito-btn:hover{background:#3b82f6}
.esito-btn.selected{background:#22c55e;color:#000}
.match-card{display:none}
.mobile-cards{display:none}
@media(max-width:600px){
  body{padding:10px;padding-bottom:200px}
  h1{font-size:1.2em}
  .tabs{gap:4px}
  .tab{padding:6px 10px;font-size:.75em}
  table{font-size:.7em}
  th,td{padding:4px 2px}
  .card{padding:10px}
  .filters select{padding:6px;font-size:.75em;max-width:100px}
  .mia-schedina{padding:10px}
  .mia-schedina-item{font-size:.75em}
  .mia-schedina-footer{gap:8px;font-size:.85em}
  .mia-schedina-footer input{width:55px;padding:5px}
  .btn{padding:6px 12px;font-size:.8em}
  #t1 table{display:none}
  .mobile-cards{display:block}
  .match-card{display:block;background:#334155;border-radius:8px;padding:12px;margin-bottom:10px}
  .match-card.top5{border-left:3px solid #f59e0b}
  .match-card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
  .match-card-teams{font-weight:bold;font-size:.95em}
  .match-card-info{color:#94a3b8;font-size:.75em}
  .match-card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}
  .match-card-stat{background:#1e293b;padding:6px;border-radius:4px;text-align:center;font-size:.75em}
  .match-card-stat b{display:block;color:#38bdf8;font-size:.9em}
  .match-card-sug{background:#166534;padding:8px;border-radius:6px;margin-top:8px;font-size:.85em}
}
</style></head><body>
<h1>🎯 Bet Analyzer</h1>
<p class="upd">Agg: ${d.aggiornato ? new Date(d.aggiornato).toLocaleString("it") : "-"} | ${d.partite.length} partite | API calls oggi: ${d.apiCallsToday || 0}</p>
<div class="filters">
<select id="filterData" onchange="applyFilters()">
<option value="">📅 Tutte le date</option>
${(d.dateUniche || []).map(dt => `<option value="${dt}">${new Date(dt).toLocaleDateString("it-IT", {weekday:"short",day:"2-digit",month:"short"})}</option>`).join("")}
</select>
<select id="filterCamp" onchange="applyFilters()">
<option value="">🏆 Tutti i campionati</option>
${(d.campionatiUnici || []).map(c => `<option value="${c}">${c}</option>`).join("")}
</select>
<select id="filterTop5" onchange="applyFilters()">
<option value="">⭐ Tutti</option>
<option value="top5">Solo Top 5</option>
</select>
</div>
<div class="tabs">
<div class="tab active" onclick="show(0)">💎 Value (${d.valueBets.length})</div>
<div class="tab" onclick="show(1)">⚽ Partite</div>
<div class="tab" onclick="show(2)">🎫 Schedine (${(d.schedine || []).length})</div>
<div class="tab" onclick="show(3)">📊 Live</div>
</div>
<div id="t0" class="card">
<h2>💎 Value Bets</h2>
<p class="sm" style="margin-bottom:10px">Value = prob. modello - prob. bookmaker | 🟢 3-15% affidabile | 🟠 >15% verificare ⚠️</p>
${d.valueBets.length ? (() => {
  const flags = {"Italia | Serie A":"🇮🇹","Italia | Serie B":"🇮🇹","Inghilterra | Premier League":"🏴","Spagna | Liga":"🇪🇸","Germania | Bundesliga":"🇩🇪","Francia | Ligue 1":"🇫🇷","Olanda | Eredivisie":"🇳🇱","Portogallo | Primeira Liga":"🇵🇹","Turchia | Super Lig":"🇹🇷","Grecia | Super League":"🇬🇷"};
  let html = '';
  let lastDate = '';
  d.valueBets.slice(0, 30).forEach(v => {
    const dataLabel = new Date(v.data).toLocaleDateString('it', {weekday:'long', day:'2-digit', month:'short'});
    if (v.data !== lastDate) {
      if (lastDate) html += '</table>';
      html += '<div style="color:#f59e0b;font-size:.85em;margin:15px 0 8px;text-transform:uppercase">📅 ' + dataLabel + '</div>';
      html += '<table><tr><th>Partita</th><th>🕒</th><th>Esito</th><th>Prob</th><th>Quota</th><th>Value</th></tr>';
      lastDate = v.data;
    }
    const flag = flags[v.camp] || '⚽';
    const ora = v.orario?.split(',')[1]?.trim() || v.orario;
    const valueColor = v.d > 15 ? '#f59e0b' : '#22c55e';
    const warning = v.d > 15 ? ' ⚠️' : '';
    html += '<tr class="vb-row ' + (v.isTop5 ? 'top5' : '') + '" data-data="' + v.data + '" data-camp="' + v.camp + '" data-top5="' + v.isTop5 + '"><td>' + flag + ' ' + v.partita + '<br><span class="sm">' + v.camp + '</span></td><td class="sm">' + ora + '</td><td><b>' + v.t + '</b></td><td>' + v.prob?.toFixed(0) + '%</td><td class="q">@' + v.q?.toFixed(2) + '</td><td style="color:' + valueColor + ';font-weight:bold">+' + v.d?.toFixed(1) + '%' + warning + '</td></tr>';
  });
  html += '</table>';
  return html;
})() : "<p>Nessun value bet trovato</p>"}
</div>
<div id="t1" class="card hide">
<h2>⚽ Partite</h2>
<div class="sm" style="margin-bottom:10px;padding:8px;background:#334155;border-radius:6px">
<b>Clicca su una partita per vedere l'analisi completa</b> | 🎯=Suggerimento migliore
</div>
<table><tr><th>Partita</th><th>📅</th><th>Gol Attesi</th><th>1 / X / 2</th><th>O2.5 / U2.5</th><th>GG / NG</th><th>🎯 Gioca</th></tr>
${d.partite.map(p => {
  const flag = {"Italia | Serie A":"🇮🇹","Italia | Serie B":"🇮🇹","Inghilterra | Premier League":"🏴","Spagna | Liga":"🇪🇸","Germania | Bundesliga":"🇩🇪","Francia | Ligue 1":"🇫🇷","Olanda | Eredivisie":"🇳🇱","Portogallo | Primeira Liga":"🇵🇹","Turchia | Super Lig":"🇹🇷","Grecia | Super League":"🇬🇷"}[p.campionato] || "⚽";
  const sug = p.suggerimento;
  const valueLabel = sug?.hasValue ? ' <span style="background:#22c55e;color:#000;padding:1px 4px;border-radius:3px;font-size:.7em">VALUE +'+sug.value?.toFixed(0)+'%</span>' : '';
  const sugCell = sug ? '<span class="val">'+sug.tipo+'</span> @'+sug.quota?.toFixed(2)+valueLabel+'<br><span class="sm">'+sug.prob?.toFixed(0)+'%</span>' : '<span class="sm">-</span>';
  const mainAnalisi = (p.analisi||[]).filter(a => !a.isExtra);
  const extraAnalisi = (p.analisi||[]).filter(a => a.isExtra);
  const analisiHtml = mainAnalisi.map(a => {
    const isBest = sug && a.tipo === sug.tipo;
    const isGood = a.value > 2 && a.prob > 45;
    const partitaSafe = p.partita.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const tipoSafe = a.tipo.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return '<div style="background:'+(isBest ? '#166534' : isGood ? '#1e3a5f' : '#334155')+';padding:8px;border-radius:6px;text-align:center;min-width:80px"><div style="font-weight:bold;color:'+(isBest ? '#4ade80' : '#e2e8f0')+'">'+a.tipo+'</div><div style="color:#38bdf8">@'+a.quota?.toFixed(2)+'</div><div class="sm">Mod '+a.prob?.toFixed(0)+'%</div><div style="color:'+(a.value > 0 ? '#22c55e' : '#ef4444')+'">'+(a.value > 0 ? '+' : '')+a.value?.toFixed(0)+'%</div><button class="esito-btn" onclick="event.stopPropagation();addToSchedina(\''+p.id+'\',\''+partitaSafe+'\',\''+tipoSafe+'\','+a.quota+')">+ Aggiungi</button></div>';
  }).join('');
  const extraHtml = extraAnalisi.length ? '<div style="margin-top:8px"><button class="esito-btn" onclick="event.stopPropagation();toggleExtra(\''+p.id+'\')" style="background:#6366f1">📊 More ('+extraAnalisi.length+')</button><div id="extra-'+p.id+'" class="hide" style="display:none;flex-wrap:wrap;gap:6px;margin-top:8px">'+extraAnalisi.map(a => {
    const partitaSafe = p.partita.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const tipoSafe = a.tipo.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const probText = a.prob ? 'Mod '+a.prob?.toFixed(0)+'%' : 'Handicap';
    return '<div style="background:#4c1d95;padding:8px;border-radius:6px;text-align:center;min-width:80px"><div style="font-weight:bold;color:#c4b5fd">'+a.tipo+'</div><div style="color:#38bdf8">@'+a.quota?.toFixed(2)+'</div><div class="sm">'+probText+'</div><button class="esito-btn" onclick="event.stopPropagation();addToSchedina(\''+p.id+'\',\''+partitaSafe+'\',\''+tipoSafe+'\','+a.quota+')">+ Aggiungi</button></div>';
  }).join('')+'</div></div>' : '';
  const sugBoxColor = sug?.hasValue ? '#166534' : '#1e3a5f';
  const sugBoxValue = sug?.hasValue ? ' | <b style="color:#4ade80">VALUE +'+sug.value?.toFixed(1)+'%</b>' : '';
  const sugBox = sug ? '<div style="margin-top:8px;padding:8px;background:'+sugBoxColor+';border-radius:6px">🎯 <b>'+sug.tipo+'</b> @'+sug.quota?.toFixed(2)+' | Modello '+sug.prob?.toFixed(0)+'%'+sugBoxValue+'</div>' : '';
  return '<tr class="match-row '+(p.isTop5 ? "top5" : "")+'" data-data="'+p.data+'" data-camp="'+p.campionato+'" data-top5="'+p.isTop5+'" style="cursor:pointer" onclick="toggleAnalisi(\''+p.id+'\')"><td>'+flag+' '+p.partita+(p.isTop5 ? '<span class="badge">TOP5</span>' : "")+(p.hasData ? '<span class="badge" style="background:#22c55e">📊</span>' : '')+'<br><span class="sm">'+p.campionato+'</span></td><td class="sm">'+p.orario+'</td><td>'+p.golAttesi[0]+' - '+p.golAttesi[1]+'</td><td>'+p.modello.p1?.toFixed(0)+'% / '+p.modello.pX?.toFixed(0)+'% / '+p.modello.p2?.toFixed(0)+'%</td><td>'+p.modello.over?.toFixed(0)+'% / '+p.modello.under?.toFixed(0)+'%</td><td>'+p.modello.gol?.toFixed(0)+'% / '+p.modello.nogol?.toFixed(0)+'%</td><td>'+sugCell+'</td></tr><tr id="analisi-'+p.id+'" class="hide"><td colspan="7" style="background:#0f172a;padding:12px"><div style="display:flex;flex-wrap:wrap;gap:6px">'+analisiHtml+'</div>'+extraHtml+sugBox+'</td></tr>';
}).join("")}</table>
<div class="mobile-cards">
${d.partite.map(p => {
  const flag = {"Italia | Serie A":"🇮🇹","Italia | Serie B":"🇮🇹","Inghilterra | Premier League":"🏴","Spagna | Liga":"🇪🇸","Germania | Bundesliga":"🇩🇪","Francia | Ligue 1":"🇫🇷","Olanda | Eredivisie":"🇳🇱","Portogallo | Primeira Liga":"🇵🇹","Turchia | Super Lig":"🇹🇷","Grecia | Super League":"🇬🇷"}[p.campionato] || "⚽";
  const sug = p.suggerimento;
  const ora = p.orario?.split(',')[1]?.trim() || p.orario;
  const sugHtml = sug ? '<div class="match-card-sug">🎯 <b>'+sug.tipo+'</b> @'+sug.quota?.toFixed(2)+' | '+sug.prob?.toFixed(0)+'%'+(sug.hasValue ? ' <span style="color:#4ade80">VALUE +'+sug.value?.toFixed(0)+'%</span>' : '')+'</div>' : '';
  return '<div class="match-card '+(p.isTop5 ? 'top5' : '')+'" data-data="'+p.data+'" data-camp="'+p.campionato+'" data-top5="'+p.isTop5+'"><div class="match-card-header"><div><div class="match-card-teams">'+flag+' '+p.partita+'</div><div class="match-card-info">'+p.campionato+(p.isTop5 ? ' • TOP5' : '')+'</div></div><div style="text-align:right"><div style="color:#38bdf8;font-weight:bold">'+ora+'</div></div></div><div class="match-card-stats"><div class="match-card-stat">⚽ Gol Attesi<b>'+p.golAttesi[0]+' - '+p.golAttesi[1]+'</b></div><div class="match-card-stat">1X2<b>'+p.modello.p1?.toFixed(0)+'/'+p.modello.pX?.toFixed(0)+'/'+p.modello.p2?.toFixed(0)+'</b></div><div class="match-card-stat">O/U 2.5<b>'+p.modello.over?.toFixed(0)+'/'+p.modello.under?.toFixed(0)+'</b></div></div><div style="font-size:.8em;color:#94a3b8">GG/NG: '+p.modello.gol?.toFixed(0)+'% / '+p.modello.nogol?.toFixed(0)+'%</div>'+sugHtml+'</div>';
}).join("")}
</div>
</div>
<div id="t2" class="card hide">
<h2>🎫 Schedine Consigliate</h2>
${(d.schedine || []).length ? (d.schedine || []).map(s => `
<div class="sch sch-row">
<div class="sch-q">@${s.quotaTot?.toFixed(2)}</div>
<b>${s.nome}</b> <span class="sm">(${s.tipo})</span>
<div style="margin-top:8px">
${s.scommesse.map(bet => {
  const flag = {"Italia | Serie A":"🇮🇹","Italia | Serie B":"🇮🇹","Inghilterra | Premier League":"🏴‍☠️","Spagna | Liga":"🇪🇸","Germania | Bundesliga":"🇩🇪","Francia | Ligue 1":"🇫🇷","Olanda | Eredivisie":"🇳🇱","Portogallo | Primeira Liga":"🇵🇹","Turchia | Super Lig":"🇹🇷","Grecia | Super League":"🇬🇷"}[bet.camp] || "⚽";
  const orario = bet.orario ? '<span style="color:#64748b">🕒 '+bet.orario.split(',')[1]?.trim()+'</span> ' : ''; return `<div class="row">${orario}${flag} ${bet.partita} → <b>${bet.t}</b> @${bet.q?.toFixed(2)} <span class="sm">(${bet.prob?.toFixed(0)}% prob)</span></div>`;
}).join("")}
</div>
</div>`).join("") : "<p>Nessuna schedina disponibile</p>"}
${d.schedinaGol ? `
<div class="sch" style="border-left:3px solid #22c55e">
<div class="sch-q">@${d.schedinaGol.quotaTot?.toFixed(2)}</div>
<b>${d.schedinaGol.nome}</b> <span class="sm">(${d.schedinaGol.tipo})</span>
<div style="margin-top:8px">
${d.schedinaGol.scommesse.map(bet => {
  const flag = {
    "Italia | Serie A":"🇮🇹","Italia | Serie B":"🇮🇹","Inghilterra | Premier League":"🏴","Spagna | Liga":"🇪🇸",
    "Germania | Bundesliga":"🇩🇪","Francia | Ligue 1":"🇫🇷","Olanda | Eredivisie":"🇳🇱","Portogallo | Primeira Liga":"🇵🇹",
    "Turchia | Super Lig":"🇹🇷","Grecia | Super League":"🇬🇷"
  }[bet.camp] || "⚽";
  const orario = bet.orario ? '<span style="color:#64748b">🕒 '+bet.orario.split(',')[1]?.trim()+'</span> ' : ''; return `<div class="row">${orario}${flag} ${bet.partita} → <b>${bet.t}</b> @${bet.q?.toFixed(2)} <span class="sm">(${bet.prob?.toFixed(0)}%)</span></div>`;
}).join("")}
</div>
</div>` : ""}
</div>
<div id="t3" class="card hide">
<h2>📊 Risultati Recenti</h2>
<div style="display:flex;gap:8px;margin-bottom:15px;flex-wrap:wrap;align-items:center">
<button class="btn" onclick="loadRisultati()">🔄 Aggiorna</button>
<select id="filterRisData" onchange="renderRisultati()" style="padding:8px;border-radius:6px;background:#334155;color:#e2e8f0;border:none">
<option value="">📅 Tutte le date</option>
</select>
<select id="filterRisCamp" onchange="renderRisultati()" style="padding:8px;border-radius:6px;background:#334155;color:#e2e8f0;border:none">
<option value="">🏆 Tutti i campionati</option>
</select>
<a href="https://www.sofascore.com/football" target="_blank" class="btn" style="text-decoration:none;background:#475569;margin-left:auto">⚽ Live</a>
</div>
<div id="risultatiContainer"><p class="sm">Caricamento risultati...</p></div>
<p class="sm" style="margin-top:10px">⚠️ Risultati aggiornati a fine partita. Per live usa Sofascore.</p>
</div>
<div id="miaSchedina" class="mia-schedina">
<h3>🎫 La Mia Schedina <span id="schedinaCount">(0)</span>
<button onclick="svuotaSchedina()" style="float:right;background:#ef4444;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.8em">🗑 Svuota</button>
<button id="verificaBtn" onclick="verificaSchedina()" style="float:right;background:#22c55e;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.8em;margin-right:8px">✅ Verifica Risultati</button>
</h3>
<div id="schedinaList" class="mia-schedina-list"></div>
<div class="mia-schedina-footer">
<span>Puntata: €</span><input type="number" id="puntata" value="3" min="1" step="0.5" onchange="aggiornaVincita()" oninput="aggiornaVincita()">
<span class="quota-tot">Quota: <span id="quotaTot">1.00</span></span>
<span class="vincita">Vincita: €<span id="vincitaPot">0.00</span></span>
</div>
</div>
<button class="btn" onclick="location.href='/api/cache-refresh'">🔄 Aggiorna (cache)</button>
<button class="btn" style="background:#dc2626;margin-left:8px" onclick="if(confirm('Fetch nuove quote da API?')) location.href='/api/refresh'">⚡ Fetch API</button>
<div class="card" style="margin-top:15px">
<h2>📊 Metodologia</h2>
<div class="sm" style="line-height:1.6">
<p><b>Modello Poisson:</b> Calcola la probabilità di ogni risultato basandosi sui gol attesi (λ) di ogni squadra. λ Casa e λ Ospite derivano dalla forza offensiva/difensiva storica delle squadre.</p>
<p style="margin-top:8px"><b>Value Bet:</b> Si verifica quando la probabilità calcolata dal modello è superiore alla probabilità implicita della quota del bookmaker di almeno il 5%. Formula: <i>Value = P(modello) - (100/quota)</i></p>
<p style="margin-top:8px"><b>1X2:</b> Probabilità vittoria casa/pareggio/vittoria ospite | <b>O/U 2.5:</b> Over/Under 2.5 gol | <b>GG/NG:</b> Entrambe segnano / No</p>
<p style="margin-top:8px"><b>⚠️ Disclaimer:</b> Questo strumento è solo a scopo informativo. Le scommesse comportano rischi finanziari.</p>
</div>
</div>
<script>
function show(i){
  document.querySelectorAll('.card').forEach((c,j)=>{if(j<4)c.classList.toggle('hide',i!==j)});
  document.querySelectorAll('.tab').forEach((t,j)=>{t.classList.toggle('active',i===j)});
}
function toggleAnalisi(id){
  const row = document.getElementById('analisi-'+id);
  if(row) row.classList.toggle('hide');
}
function toggleExtra(id){
  const el = document.getElementById('extra-'+id);
  if(el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}
function applyFilters(){
  const data = document.getElementById('filterData').value;
  const camp = document.getElementById('filterCamp').value;
  const top5 = document.getElementById('filterTop5').value;
  document.querySelectorAll('.match-row, .vb-row, .match-card').forEach(row => {
    let visible = true;
    if(data && row.dataset.data !== data) visible = false;
    if(camp && row.dataset.camp !== camp) visible = false;
    if(top5 === 'top5' && row.dataset.top5 !== 'true') visible = false;
    row.style.display = visible ? '' : 'none';
  });
  // Nascondi intestazioni data e tabelle vuote nella tab Value
  const t0 = document.getElementById('t0');
  if(t0) {
    const tables = t0.querySelectorAll('table');
    tables.forEach(table => {
      const visibleRows = table.querySelectorAll('.vb-row:not([style*="display: none"])');
      const hasVisible = visibleRows.length > 0;
      table.style.display = hasVisible ? '' : 'none';
      // Nascondi anche il div intestazione data precedente
      const prev = table.previousElementSibling;
      if(prev && prev.textContent.includes('📅')) prev.style.display = hasVisible ? '' : 'none';
    });
  }
  // Filtra schedine - nascondi se nessuna scommessa corrisponde ai filtri
  document.querySelectorAll('.sch-row').forEach(sch => {
    const rows = sch.querySelectorAll('.row');
    let anyVisible = !data && !camp; // se nessun filtro, mostra tutto
    rows.forEach(r => {
      const txt = r.textContent;
      let match = true;
      if(camp && !txt.includes(camp.split(' | ')[1] || camp)) match = false;
      if(match && (data || camp)) anyVisible = true;
    });
    sch.style.display = anyVisible ? '' : 'none';
  });
}

// Schedina personalizzata (con localStorage)
let miaSchedina = JSON.parse(localStorage.getItem('miaSchedina') || '[]');

function saveSchedina() {
  localStorage.setItem('miaSchedina', JSON.stringify(miaSchedina));
}

function addToSchedina(id, partita, esito, quota) {
  miaSchedina = miaSchedina.filter(s => s.id !== id);
  miaSchedina.push({ id, partita, esito, quota, risultato: null });
  saveSchedina();
  renderSchedina();
}

function removeFromSchedina(id) {
  miaSchedina = miaSchedina.filter(s => s.id !== id);
  saveSchedina();
  renderSchedina();
}

function svuotaSchedina() {
  miaSchedina = [];
  saveSchedina();
  renderSchedina();
}

function renderSchedina() {
  const panel = document.getElementById('miaSchedina');
  const list = document.getElementById('schedinaList');
  const countEl = document.getElementById('schedinaCount');
  const quotaTotEl = document.getElementById('quotaTot');
  
  if (miaSchedina.length === 0) {
    panel.classList.remove('active');
    return;
  }
  
  panel.classList.add('active');
  countEl.textContent = '(' + miaSchedina.length + ')';
  
  let html = '';
  let quotaTot = 1;
  miaSchedina.forEach(s => {
    quotaTot *= s.quota;
    let statusIcon = '';
    if (s.risultato === 'vinto') statusIcon = ' <span style="color:#22c55e">\u2705</span>';
    else if (s.risultato === 'perso') statusIcon = ' <span style="color:#ef4444">\u274c</span>';
    else if (s.risultato === 'incorso') statusIcon = ' <span style="color:#f59e0b">\u23f3</span>';
    html += '<div class="mia-schedina-item"><span>' + s.partita + ' \u2192 <b>' + s.esito + '</b>' + statusIcon + '</span><span>@' + s.quota.toFixed(2) + '<span class="remove" onclick="removeFromSchedina(&quot;' + s.id + '&quot;)">❌</span></span></div>';
  });
  
  list.innerHTML = html;
  quotaTotEl.textContent = quotaTot.toFixed(2);
  aggiornaVincita();
}

function aggiornaVincita() {
  const puntata = parseFloat(document.getElementById('puntata').value) || 0;
  const quotaTot = parseFloat(document.getElementById('quotaTot').textContent) || 1;
  const vincita = puntata * quotaTot;
  document.getElementById('vincitaPot').textContent = vincita.toFixed(2);
}

async function verificaSchedina() {
  if (miaSchedina.length === 0) return;
  
  const btn = document.getElementById('verificaBtn');
  btn.textContent = '\u23f3 Verifica in corso...';
  btn.disabled = true;
  
  try {
    const res = await fetch('/api/verifica-schedina', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partite: miaSchedina })
    });
    const data = await res.json();
    
    if (data.risultati) {
      miaSchedina = miaSchedina.map(s => {
        const r = data.risultati.find(x => x.id === s.id);
        if (r) s.risultato = r.stato;
        return s;
      });
      saveSchedina();
      renderSchedina();
      
      const vinte = miaSchedina.filter(s => s.risultato === 'vinto').length;
      const perse = miaSchedina.filter(s => s.risultato === 'perso').length;
      const incorso = miaSchedina.filter(s => s.risultato === 'incorso' || !s.risultato).length;
      
      let msg = '\u2705 Vinte: ' + vinte + ' | \u274c Perse: ' + perse + ' | \u23f3 In corso: ' + incorso;
      
      if (incorso === 0) {
        // Tutte finite!
        if (perse > 0) {
          msg = '\ud83d\udcca SCHEDINA COMPLETATA\\n\\n' + msg + '\\n\\n\u274c Schedina PERSA';
        } else {
          const vincita = document.getElementById('vincitaPot').textContent;
          msg = '\ud83c\udf89 SCHEDINA COMPLETATA\\n\\n' + msg + '\\n\\n\ud83d\udcb0 HAI VINTO \u20ac' + vincita + '!';
        }
        // Aggiorna anche i risultati
        loadRisultati();
      } else {
        msg += '\\n\\nAlcune partite sono ancora in corso...';
      }
      alert(msg);
    }
  } catch (e) {
    alert('Errore verifica: ' + e.message);
  }
  
  btn.textContent = '\u2705 Verifica Risultati';
  btn.disabled = false;
}

// Carica schedina salvata all'avvio
renderSchedina();

// Cache risultati
let risultatiCache = null;

async function loadRisultati() {
  const container = document.getElementById('risultatiContainer');
  container.innerHTML = '<p>\u23f3 Caricamento...</p>';
  try {
    const res = await fetch('/api/risultati');
    risultatiCache = await res.json();
    renderRisultati();
  } catch (e) {
    container.innerHTML = '<p style="color:#ef4444">Errore: ' + e.message + '</p>';
  }
}

function renderRisultati() {
  const container = document.getElementById('risultatiContainer');
  if (!risultatiCache || !risultatiCache.scores.length) {
    container.innerHTML = '<p>Nessun risultato disponibile</p>';
    return;
  }
  
  const filterData = document.getElementById('filterRisData')?.value || '';
  const filterCamp = document.getElementById('filterRisCamp')?.value || '';
  const flags = {'Italia | Serie A':'🇮🇹','Italia | Serie B':'🇮🇹','Inghilterra | Premier League':'🏴','Spagna | Liga':'🇪🇸','Germania | Bundesliga':'🇩🇪','Francia | Ligue 1':'🇫🇷','Olanda | Eredivisie':'🇳🇱','Portogallo | Primeira Liga':'🇵🇹','Turchia | Super Lig':'🇹🇷','Grecia | Super League':'🇬🇷'};
  
  // Popola filtri
  const dateSet = new Set();
  const campSet = new Set();
  risultatiCache.scores.forEach(m => {
    dateSet.add(new Date(m.commence_time).toISOString().split('T')[0]);
    campSet.add(m.league);
  });
  const filterDataEl = document.getElementById('filterRisData');
  const filterCampEl = document.getElementById('filterRisCamp');
  if (filterDataEl && filterDataEl.options.length <= 1) {
    [...dateSet].sort().reverse().forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = new Date(d).toLocaleDateString('it', {weekday:'short', day:'2-digit', month:'short'});
      filterDataEl.appendChild(opt);
    });
  }
  if (filterCampEl && filterCampEl.options.length <= 1) {
    [...campSet].sort().forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = (flags[c]||'⚽') + ' ' + c;
      filterCampEl.appendChild(opt);
    });
  }
  
  // Filtra
  let filtered = risultatiCache.scores;
  if (filterCamp) filtered = filtered.filter(m => m.league === filterCamp);
  if (filterData) filtered = filtered.filter(m => new Date(m.commence_time).toISOString().split('T')[0] === filterData);
  
  if (!filtered.length) {
    container.innerHTML = '<p>Nessun risultato per i filtri selezionati</p>';
    return;
  }
  
  let html = '<p class="sm" style="margin-bottom:10px">🔄 ' + new Date(risultatiCache.timestamp).toLocaleString('it') + ' | ' + filtered.length + ' partite</p>';
  
  // Raggruppa per campionato -> data
  const byLeague = {};
  filtered.forEach(m => {
    if (!byLeague[m.league]) byLeague[m.league] = {};
    const data = new Date(m.commence_time).toISOString().split('T')[0];
    if (!byLeague[m.league][data]) byLeague[m.league][data] = [];
    byLeague[m.league][data].push(m);
  });
  
  for (const [league, dates] of Object.entries(byLeague)) {
    const flag = flags[league] || '⚽';
    html += '<div style="background:#334155;border-radius:8px;padding:10px;margin-bottom:8px"><div style="color:#f59e0b;font-size:.9em;margin-bottom:8px;font-weight:bold">' + flag + ' ' + league + '</div>';
    
    const sortedDates = Object.keys(dates).sort().reverse();
    for (const data of sortedDates) {
      const matches = dates[data].sort((a,b) => new Date(a.commence_time) - new Date(b.commence_time));
      const giornoLabel = new Date(data).toLocaleDateString('it', {weekday:'long', day:'2-digit', month:'short'});
      html += '<div style="color:#94a3b8;font-size:.75em;margin:8px 0 4px;text-transform:uppercase">📅 ' + giornoLabel + '</div>';
      
      matches.forEach(m => {
        const hs = m.scores?.find(s => s.name === m.home_team)?.score || '0';
        const as = m.scores?.find(s => s.name === m.away_team)?.score || '0';
        const ora = new Date(m.commence_time).toLocaleTimeString('it', {hour:'2-digit', minute:'2-digit'});
        html += '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid #475569;font-size:.8em"><span style="color:#64748b;width:45px">' + ora + '</span><span style="flex:1">' + m.home_team + ' - ' + m.away_team + '</span><b style="color:#22c55e">' + hs + ' - ' + as + '</b></div>';
      });
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

// Carica risultati all'avvio
loadRisultati();
</script></body></html>`;
}

// Start
(async () => {
  teamStats = await loadHistoricalData();
  console.log(`Caricate stats per ${Object.keys(teamStats).length} squadre`);
  await aggiorna();
  server = app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
})();
setInterval(aggiorna, 15 * 60 * 1000);
