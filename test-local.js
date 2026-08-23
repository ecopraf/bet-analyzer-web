// Test locale - usa puppeteer normale invece di puppeteer-core
const puppeteer = require('puppeteer');

async function test() {
  console.log("Avvio browser...");
  const browser = await puppeteer.launch({ headless: false }); // headless: false per vedere cosa succede
  const page = await browser.newPage();
  
  let eventi = [];
  const visti = new Set();

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/") || url.includes("Event")) {
      console.log(`API: ${url.substring(0, 100)}`);
    }
    if (url.includes("getOverviewEventsAams") || url.includes("Event")) {
      try {
        const json = await res.json();
        console.log(`Response keys: ${Object.keys(json).join(", ")}`);
        const evList = json?.leo || json?.events || [];
        console.log(`Eventi trovati: ${evList.length}`);
        for (const e of evList)
          if (e.ei && !visti.has(e.ei)) { visti.add(e.ei); eventi.push(e); }
      } catch {}
    }
  });

  await page.goto("https://www.planetwin365.it/it/scommesse-sportive#/sport/s/1/calcio", {
    waitUntil: "networkidle2", timeout: 60000
  });
  
  console.log("Pagina caricata, titolo:", await page.title());
  await new Promise(r => setTimeout(r, 5000));

  // Prova click su Italia
  const clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll("span,div,a")].find(e => e.innerText?.trim() === "Italia");
    if (el) { el.click(); return true; }
    return false;
  });
  console.log("Click Italia:", clicked);
  
  await new Promise(r => setTimeout(r, 3000));
  console.log(`\nTotale eventi: ${eventi.length}`);
  
  // Lascia il browser aperto per debug
  // await browser.close();
}

test().catch(console.error);
