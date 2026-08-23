# Bet Analyzer Web

Dashboard automatica per analisi scommesse con modello Poisson/Dixon-Coles.

## Deploy su Render.com (GRATUITO)

1. Crea account su https://render.com
2. Collega il tuo GitHub
3. Crea nuovo repository e pusha questa cartella:
   ```bash
   cd bet-analyzer-web
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create bet-analyzer-web --public --push
   ```
4. Su Render: New → Web Service → Seleziona il repo
5. Render rileva automaticamente Node.js e deploya

## Funzionalità

- 🎯 Analisi automatica partite TOP 5 campionati
- 💎 Rilevamento VALUE BET (modello vs quote)
- 📊 Modello Poisson + Dixon-Coles
- 🔄 Aggiornamento automatico ogni 15 minuti

## Test locale

```bash
npm install
npm start
# Apri http://localhost:3000
```
