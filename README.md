# Bet Analyzer Web

Dashboard automatica per analisi scommesse con modello Poisson.

## 🚀 Quick Start

```bash
npm install
npm start
# Apri http://localhost:3000
```

## 📊 Architettura

```
server.js          # Server Express + logica analisi
cache/             # Cache settimanale quote (JSON)
package.json       # Dipendenze Node.js
```

## 🔑 API Keys

Utilizza **The Odds API** con rotazione di 4 chiavi per evitare rate limiting:
- Le chiavi sono definite in `ODDS_API_KEYS[]`
- Rotazione automatica ad ogni chiamata via `getNextApiKey()`
- Piano gratuito: 500 richieste/mese per chiave

## 📈 Modello Matematico

### Distribuzione di Poisson

Calcola la probabilità di ogni risultato basandosi sui **gol attesi (λ)** di ogni squadra.

```
P(k gol) = (λ^k * e^-λ) / k!
```

### Calcolo Lambda (λ)

```javascript
λ Casa = (attacco_casa * difesa_ospite / media_campionato) * 1.1  // +10% fattore casa
λ Ospite = (attacco_ospite * difesa_casa / media_campionato) * 0.9  // -10% trasferta
```

Dove:
- `attacco` = gol fatti / partite giocate
- `difesa` = gol subiti / partite giocate
- `media_campionato` = 1.35 (fallback)

### Fonti Dati Storici

1. **Football-Data.co.uk** - Dati stagione corrente (CSV)
2. **The Odds API /scores** - Risultati ultimi 3 giorni

## 🎯 Logica Suggerimenti

I suggerimenti vengono generati SOLO se rispettano questi criteri basati sul modello Poisson:

| Tipo            | Prob Minima | Condizione λ                  | Value Minimo |
|-----------------|-------------|-------------------------------|--------------|
| **1** (Casa)    | ≥ 55%       | -                             | > 2%         |
| **2** (Ospite)  | ≥ 55%       | -                             | > 2%         |
| **X** (Pareggio)| ≥ 28%       | -                             | ≥ 3%         |
| **Over 2.5**    | ≥ 55%       | λC + λO ≥ 2.5                 | > 2%         |
| **Under 2.5**   | ≥ 55%       | λC + λO < 2.5                 | > 2%         |
| **GG** (Gol)    | ≥ 55%       | λC ≥ 1.0 **E** λO ≥ 1.0       | > 2%         |
| **NG** (No Gol) | ≥ 55%       | λC < 1.0 **O** λO < 1.0       | > 2%         |

### Value Bet

```
Value = P(modello) - P(bookmaker)
P(bookmaker) = 100 / quota
```

Un value bet è valido quando il modello stima una probabilità **superiore** a quella implicita nella quota.

## 📦 Mercati Quote Disponibili

Richiesti in una singola chiamata API (nessun costo extra):

| Market | Descrizione | Uso |
|--------|-------------|-----|
| `h2h` | 1X2 | Quote principali |
| `totals` | Over/Under 2.5 | Quote principali |
| `btts` | GG/NG (Both Teams To Score) | Quote principali |
| `spreads` | Handicap asiatico | Quote extra (More) |
| `double_chance` | 1X, X2, 12 | Quote extra (More) |

## 🗂 Cache Strategy

### Cache Settimanale Quote
- File: `cache/quotes_week_YYYY-WNN.json`
- Contiene tutte le quote della settimana
- Evita chiamate API ripetute per le stesse partite

### Refresh Dati
- **"Aggiorna (cache)"**: usa cache se disponibile
- **"Fetch API"**: forza nuova chiamata API (cancella cache)

## 🎫 Schedine

### Schedine Consigliate (Auto-generate)
1. **Singola Sicura**: 1 value bet con prob > 60%
2. **Doppia Value**: 2 value bet con prob > 55%
3. **Tris**: 3 value bet con prob > 50%
4. **Schedina Gol**: Mix GG/NG basato su modello

### Schedina Personalizzata
- Salvata in `localStorage`
- Verifica risultati via API `/api/verifica-schedina`
- Mostra stato: ✅ Vinta, ❌ Persa, ⏳ In corso

## 🔄 Endpoints API

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/` | GET | Dashboard HTML |
| `/api/data` | GET | Dati JSON (partite, valueBets, schedine) |
| `/api/refresh` | GET | Forza fetch da API |
| `/api/cache-refresh` | GET | Usa cache se disponibile |
| `/api/risultati` | GET | Risultati partite finite (ultime 48h) |
| `/api/verifica-schedina` | POST | Verifica esiti schedina |

## 🏆 Campionati Supportati

| Campionato | Key API | Top 5 |
|------------|---------|-------|
| Italia Serie A | `soccer_italy_serie_a` | ✅ |
| Italia Serie B | `soccer_italy_serie_b` | ❌ |
| Inghilterra Premier League | `soccer_epl` | ✅ |
| Spagna Liga | `soccer_spain_la_liga` | ✅ |
| Germania Bundesliga | `soccer_germany_bundesliga` | ✅ |
| Francia Ligue 1 | `soccer_france_ligue_one` | ✅ |
| Olanda Eredivisie | `soccer_netherlands_eredivisie` | ❌ |
| Portogallo Primeira Liga | `soccer_portugal_primeira_liga` | ❌ |
| Turchia Super Lig | `soccer_turkey_super_league` | ❌ |
| Grecia Super League | `soccer_greece_super_league` | ❌ |

## ⚠️ Regole di Sviluppo

### Escape Caratteri
Quando si genera HTML con valori dinamici (es. nomi partite, tipi scommessa):
```javascript
const safe = value.replace(/'/g, "\\'").replace(/"/g, '&quot;');
```

### Filtri UI
I filtri (data, campionato, top5) devono applicarsi a:
- ✅ Tabella Value Bets
- ✅ Tabella Partite
- ✅ Schedine Consigliate

### Consumo API
- Minimizzare chiamate API (usare cache)
- Una chiamata con più markets è meglio di più chiamate separate
- I risultati live NON sono in tempo reale (solo a fine partita)

## 📱 UI/UX

### Tab Principali
1. **💎 Value**: Value bets ordinati per valore
2. **⚽ Partite**: Tutte le partite con analisi espandibile
3. **🎫 Schedine**: Schedine consigliate
4. **📊 Risultati**: Risultati partite finite

### Analisi Partita (Click per espandere)
- Quote principali: 1, X, 2, Over, Under, GG, NG
- Pulsante "📊 More" per quote extra (1X, X2, 12, Handicap)
- Box verde con suggerimento migliore

### Colori Indicatori
- 🟢 Verde (`#22c55e`): Value positivo, vinto
- 🔴 Rosso (`#ef4444`): Value negativo, perso
- 🟡 Arancione (`#f59e0b`): In corso, top5
- 🔵 Blu (`#3b82f6`): Quote, azioni

## 🚀 Deploy su Render.com

1. Crea account su https://render.com
2. Collega GitHub
3. New → Web Service → Seleziona repo
4. Render rileva Node.js automaticamente

## ⚠️ Disclaimer

Questo strumento è solo a scopo informativo e di studio.
Le scommesse comportano rischi finanziari. Gioca responsabilmente.
