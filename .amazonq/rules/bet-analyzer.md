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
server.js                    # Server Express monolitico (~1400 righe)
                             # - Backend API + Frontend HTML inline
                             # - Modello Poisson + logica value bet
                             # - CSS/JS embedded nella funzione getHTML()
cache/
  historical_2526.json       # Dati storici 25/26 (184 squadre) - FISSO
  results_2627.json          # Risultati 26/27 locale (backup)
package.json                 # Solo express@4.18.2, Node 20.x
render.yaml                  # Deploy Render.com
Bet-Analyzer-Favicon.png     # Favicon custom
```

## 🔑 API Esterne

### The Odds API
- 4 chiavi in `ODDS_API_KEYS[]` con rotazione smart
- `exhaustedKeys` Set traccia chiavi esaurite (401)
- `markKeyExhausted(key)` marca e logga chiave esaurita
- Su 401: marca chiave, riprova con prossima disponibile
- Se tutte esaurite: resetta Set e riprova
- Markets: `h2h`, `totals`, `btts`, `spreads`, `double_chance`
- 500 req/mese per chiave (piano gratuito)
- **Chiamate API solo su richiesta utente** (bottoni dedicati)

### Football-Data.co.uk
- CSV stagione 2025/26 in `HISTORICAL_URLS`
- Dati storici per calcolo λ (lambda)
- Cache locale in `cache/historical_2526.json`

### JSONBin.io
- Master Key: configurata in `JSONBIN_MASTER_KEY`
- Bin: `bet-analyzer-results-2627` (creato automaticamente)
- Persistenza risultati stagione corrente su Render

## 📊 Sistema Pesi Dinamici

```javascript
// Soglia: 15 partite per squadra = 100% dati correnti
const WEIGHT_THRESHOLD = 15;

// Calcolo peso
Se partite_correnti >= 15 → 100% stagione corrente
Altrimenti:
  peso_corrente = partite / 15
  peso_storico = 1 - peso_corrente

// Esempio: 5 partite → 33% corrente, 67% storico
```

| Giornate | Peso 26/27 | Peso 25/26 |
|----------|------------|------------|
| 0 | 0% | 100% |
| 5 | 33% | 67% |
| 10 | 67% | 33% |
| 15+ | 100% | 0% |

## 📊 Modello Matematico

```javascript
// Lambda (gol attesi) - usa stats pesate
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

## 🎫 Schedine Auto-Generate

| Tipo | Logica |
|------|--------|
| **Raddoppio** | 1-3 eventi fino a quota ≥2, ordinati per (prob + value) |
| **Mista Gol/Over** | Max 6 eventi GG/Over 2.5, quota min 1.45 |
| **Schedina Gol** | Combinazione GG/NG |

## 🔄 API Endpoints

| Endpoint | Chiama API? | Descrizione |
|----------|-------------|-------------|
| `GET /` | ❌ | Dashboard HTML |
| `GET /api/data` | ❌ | JSON completo (da cache) |
| `GET /api/refresh` | ✅ | Forza fetch quote da API |
| `GET /api/cache-refresh` | ❌ | Usa cache locale |
| `GET /api/risultati` | ❌ | Risultati da JSONBin (cache) |
| `GET /api/risultati-refresh` | ✅ | Fetch risultati da API + salva JSONBin |
| `POST /api/verifica-schedina` | ✅ | Verifica esiti + aggiorna JSONBin |
| `GET /favicon.png` | ❌ | Favicon custom |

## 🏆 10 Campionati

Serie A, Serie B, Premier League, Liga, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Super Lig, Super League

**Top 5**: Serie A, Premier, Liga, Bundesliga, Ligue 1

## 🎨 UI - 4 Tab

1. **💎 Value** - Value bets ordinati (tabella desktop, cards mobile)
2. **⚽ Partite** - Analisi espandibile + cards mobile con dettagli
3. **🎫 Schedine** - Auto-generate + "Le Mie Schedine" + "Verifica Tutte"
4. **📊 Live** - Risultati recenti, ordinati per campionato (Top 5 prima), timestamp ultimo aggiornamento

## 📱 Mobile UX

- **FAB Schedina**: Pulsante flottante in basso a destra con counter
- **Modal Schedina**: Apre dettagli, puntata, salva/svuota
- **Cards Partite**: Layout card invece di tabella su mobile
- **Cards espandibili**: Click per vedere dettagli e aggiungere a schedina

## 🎫 Flusso Schedina Utente

1. Vai su **Partite** → clicca esito → aggiunto a schedina
2. Clicca **FAB** (🎫 Schedina) → vedi dettagli
3. Imposta puntata → **💾 Salva**
4. Vai su **Schedine** → vedi in "Le Mie Schedine"
5. Clicca **🔄 Verifica Tutte** → controlla risultati

## ⚠️ Regole Sviluppo

### ❌ MAI usare escape Unicode nel JS inline
```javascript
// ❌ SBAGLIATO - causa "Unexpected string" error
el.textContent = '\u23f3 Caricamento...';
el.textContent = '\ud83d\udd52 Ultimo aggiornamento';
showModal('\u2705', 'Titolo', 'Messaggio');

// ✅ CORRETTO - usa emoji direttamente
el.textContent = '⏳ Caricamento...';
el.textContent = '🕒 Ultimo aggiornamento';
showModal('✅', 'Titolo', 'Messaggio');
```

### Escape HTML (per onclick con JSON)
```javascript
// ❌ SBAGLIATO - virgolette rompono onclick
onclick='func({"key":"value"})'

// ✅ CORRETTO - usa base64 per dati complessi
const scommesseB64 = Buffer.from(JSON.stringify(data)).toString('base64');
// HTML: data-scommesse="${scommesseB64}" onclick="func(this)"
// JS browser: JSON.parse(atob(btn.dataset.scommesse))
```

### Escape stringhe in onclick
```javascript
// ❌ SBAGLIATO - \' dentro stringa singola non funziona
html += '<span onclick="func(\''+id+'\')">X</span>';
// Produce: onclick="func('id')" - ERRORE!

// ✅ CORRETTO - usa \x27 per apostrofo
html += '<span onclick="func(\x27'+id+'\x27)">X</span>';
// Produce: onclick="func('id')" - OK!
```

### Colori UI
- Verde `#22c55e` - Value positivo, vinto
- Rosso `#ef4444` - Value negativo, perso
- Arancione `#f59e0b` - In corso, Top5
- Blu `#3b82f6` - Quote, azioni, FAB

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

### Modal Custom
```javascript
showModal(icon, title, message, onConfirm?)
// onConfirm = null → solo OK
// onConfirm = function → Annulla + Conferma
```

### Cache
- Quote: `cache/quotes_week_YYYY-WNN.json` (refresh 15 min)
- Storico: `cache/historical_2526.json` (fisso, committato)
- Corrente: JSONBin.io (persistente su Render)

## 🚀 Deploy

```bash
# Render.com (auto da GitHub)
# Filesystem effimero → JSONBin.io per persistenza

# Locale
npm install && npm start
```

## 📝 Note Importanti

- **Stagione corrente**: 2026/27
- **Stagione storica**: 2025/26
- **Lingua UI**: Italiano
- **API calls**: Solo su bottoni dedicati (risparmio quota)
- **Render**: Filesystem effimero, usa JSONBin per dati persistenti
