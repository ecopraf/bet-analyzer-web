# Bet Analyzer Web - Regole Onboarding

## 🚀 Comandi Locali

```bash
# Avvio server
npm start                    # http://localhost:3000

# Installazione dipendenze
npm install

# Test (richiede puppeteer)
node test-local.js
```

## 📁 Struttura Progetto

```
server.js          # Server Express monolitico (~900 righe)
                   # - Backend API + Frontend HTML inline
                   # - Modello Poisson + logica value bet
                   # - CSS/JS embedded nella funzione getHTML()
cache/             # Cache settimanale quote JSON
package.json       # Solo express@4.18.2, Node 20.x
render.yaml        # Deploy Render.com
```

## 🔑 API Esterne

### The Odds API
- 4 chiavi in `ODDS_API_KEYS[]` con rotazione automatica
- Markets: `h2h`, `totals`, `btts`, `spreads`, `double_chance`
- 500 req/mese per chiave (piano gratuito)

### Football-Data.co.uk
- CSV stagione 2025/26 in `HISTORICAL_URLS`
- Dati storici per calcolo λ (lambda)

## 📊 Modello Matematico

```javascript
// Lambda (gol attesi)
λ Casa = (attacco_casa * difesa_ospite / 1.35) * 1.1    // +10% casa
λ Ospite = (attacco_ospite * difesa_casa / 1.35) * 0.9  // -10% trasferta

// Value Bet
Value = P(modello) - (100 / quota)  // Valido se > 3%
```

## 🎯 Criteri Suggerimenti

| Tipo | Prob Min | Condizione λ | Value Min |
|------|----------|--------------|-----------|
| 1/2 | ≥55% | - | >2% |
| X | ≥28% | - | ≥3% |
| Over 2.5 | ≥55% | λC+λO ≥2.5 | >2% |
| Under 2.5 | ≥55% | λC+λO <2.5 | >2% |
| GG | ≥55% | λC≥1 E λO≥1 | >2% |
| NG | ≥55% | λC<1 O λO<1 | >2% |

## 🔄 API Endpoints

| Endpoint | Descrizione |
|----------|-------------|
| `GET /` | Dashboard HTML |
| `GET /api/data` | JSON completo |
| `GET /api/refresh` | Forza fetch API |
| `GET /api/cache-refresh` | Usa cache |
| `GET /api/risultati` | Risultati 48h |
| `POST /api/verifica-schedina` | Verifica esiti |

## 🏆 10 Campionati

Serie A, Serie B, Premier League, Liga, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Super Lig, Super League

**Top 5**: Serie A, Premier, Liga, Bundesliga, Ligue 1

## 🎨 UI - 4 Tab

1. **💎 Value** - Value bets ordinati (tabella con colonne fisse)
2. **⚽ Partite** - Analisi espandibile + pulsante "More"
3. **🎫 Schedine** - Auto-generate + personalizzata (localStorage)
4. **📊 Live** - Risultati recenti

## ⚠️ Regole Sviluppo

### Escape HTML
```javascript
const safe = value.replace(/'/g, "\\'").replace(/"/g, '&quot;');
```

### Colori UI
- Verde `#22c55e` - Value positivo, vinto
- Rosso `#ef4444` - Value negativo, perso
- Arancione `#f59e0b` - In corso, Top5
- Blu `#3b82f6` - Quote, azioni

### CSS Tabella Value (t0)
```css
table{table-layout:fixed}
#t0 table th:nth-child(1),td:nth-child(1){width:40%}  /* Partita */
#t0 table th:nth-child(2),td:nth-child(2){width:10%}  /* Orario */
#t0 table th:nth-child(3),td:nth-child(3){width:12%}  /* Esito */
#t0 table th:nth-child(4),td:nth-child(4){width:12%}  /* Prob */
#t0 table th:nth-child(5),td:nth-child(5){width:12%}  /* Quota */
#t0 table th:nth-child(6),td:nth-child(6){width:14%}  /* Value */
```

### Cache
- File: `cache/quotes_week_YYYY-WNN.json`
- Refresh automatico ogni 15 minuti
- "Fetch API" cancella e rigenera cache

## 🚀 Deploy

```bash
# Render.com (auto da GitHub)
# oppure manuale:
npm install && npm start
```
