// Format helpers
function trPercent(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    return (n).toFixed(2).replace('.', ',');
}

function toNumberTR(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const s = String(v).replaceAll(' ', '').replace('%','').replace('.', '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

async function fetchYahooMeta(symbol) {
    // Use Vercel serverless function as proxy to avoid CORS
    const response = await fetch(`/api/rates?symbol=${symbol}`);
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose ?? meta.chartPreviousClose;
    const changePct = (price != null && prev)
        ? ((price - prev) / prev) * 100
        : null;
    return { price, prev, changePct };
}

function setTrend(idBase, changePct) {
    const arrow = document.getElementById(`arrow-${idBase}`);
    const pct = document.getElementById(`pct-${idBase}`);
    const ribbon = document.getElementById(`ribbon-${idBase}`);
    
    if (!arrow || !pct) return;
    if (changePct === null || changePct === undefined || isNaN(changePct)) {
        arrow.className = 'arrow';
        pct.textContent = '';
        if (ribbon) {
            ribbon.className = 'ribbon'; // neutral - default color
            ribbon.classList.remove('green', 'red');
        }
        return;
    }
    
    // Her değişimi göster - sürekli dinamik
    if (changePct >= 0) {
        // Artış - yeşil
        arrow.className = 'arrow up';
        if (ribbon) {
            ribbon.className = 'ribbon green';
        }
    } else {
        // Düşüş - kırmızı
        arrow.className = 'arrow down';
        if (ribbon) {
            ribbon.className = 'ribbon red';
        }
    }
    
    const sign = changePct >= 0 ? '' : '';
    pct.textContent = `%${trPercent(Math.abs(changePct))}`;
}

// Tick-to-tick dynamic arrow with visual flash
const lastTickKey = 'kur_last_tick_v1';
let lastTick = {};
try { lastTick = JSON.parse(localStorage.getItem(lastTickKey) || '{}'); } catch {}

function setArrowFromTick(idBase, newPrice) {
    const arrow = document.getElementById(`arrow-${idBase}`);
    if (!arrow || newPrice == null || isNaN(newPrice)) return;
    const old = lastTick[idBase];
    const epsRel = 0.0005; // 0.05% eşik; gürültüyü filtrele
    if (old != null && old > 0) {
        const rel = Math.abs(newPrice - old) / old;
        if (rel <= epsRel) return; // çok küçük oynaklıkta değiştirme
        if (newPrice > old) {
            arrow.className = 'arrow up flash-up';
        } else if (newPrice < old) {
            arrow.className = 'arrow down flash-down';
        }
    }
    lastTick[idBase] = newPrice;
}

function setValue(idBase, price, unit) {
    const el = document.getElementById(`val-${idBase}`);
    if (!el) return;
    if (price == null || isNaN(price)) { el.textContent = ''; return; }
    const formatted = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 4 }).format(price);
    el.textContent = unit ? `${formatted} ${unit}` : formatted;
}

function updateTimestamp() {
    const el = document.getElementById('last-update');
    if (!el) return;
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(now);
    el.textContent = `Son Güncelleme: ${formatted}`;
}

// Gram ve Çeyrek altın hesaplama (Yahoo metasından)
function computeGramCeyrek(xau, usdtry) {
    const OUNCE_TO_GRAM = 31.1035;
    const CEYREK_WEIGHT = 1.75; // gram
    if (!xau?.price || !usdtry?.price) return null;
    const gramUSD = xau.price / OUNCE_TO_GRAM;
    const gramTL = gramUSD * usdtry.price;
    let pct = null;
    if (xau?.prev && usdtry?.prev) {
        const prevGramUSD = xau.prev / OUNCE_TO_GRAM;
        const prevGramTL = prevGramUSD * usdtry.prev;
        pct = ((gramTL - prevGramTL) / prevGramTL) * 100;
    } else if (xau?.changePct != null && usdtry?.changePct != null) {
        pct = xau.changePct + usdtry.changePct; // yaklaşık
    }
    const ceyrekTL = gramTL * CEYREK_WEIGHT;
    return { gramTL, gramPct: pct, ceyrekTL, ceyrekPct: pct };
}

// XAU yedeği: exchangerate.host (anahtarsız)
async function fetchXAUFromHost() {
    try {
        const r = await fetch('https://api.exchangerate.host/latest?base=XAU&symbols=USD,TRY');
        const j = await r.json();
        if (j?.rates) return { ozUSD: j.rates.USD, ozTRY: j.rates.TRY };
    } catch {}
    return null;
}

async function fetchRates() {
    try {
        // Yahoo Finance - Ons, Gümüş, DXY, ve pariteler
        const [xau, xag, dxy, usdtry, eurtry, eurusd, gbptry] = await Promise.all([
            fetchYahooMeta('GC=F'),
            fetchYahooMeta('SI=F'),
            fetchYahooMeta('DX-Y.NYB'),
            fetchYahooMeta('USDTRY=X'),
            fetchYahooMeta('EURTRY=X'),
            fetchYahooMeta('EURUSD=X'),
            fetchYahooMeta('GBPTRY=X')
        ]);

        // Gram & Çeyrek: Yahoo'dan hesapla, yoksa exchangerate.host ile yedekle
        let gramSell = null, ceyrekSell = null, gramPct = null, ceyrekPct = null;
        const calc = computeGramCeyrek(xau, usdtry);
        if (calc) {
            gramSell = calc.gramTL; ceyrekSell = calc.ceyrekTL; gramPct = calc.gramPct; ceyrekPct = calc.ceyrekPct;
        } else {
            const host = await fetchXAUFromHost();
            if (host) {
                const OUNCE_TO_GRAM = 31.1035; const CEYREK_WEIGHT = 1.75;
                if (host.ozTRY) {
                    const gramTRY = host.ozTRY / OUNCE_TO_GRAM;
                    gramSell = gramTRY; ceyrekSell = gramTRY * CEYREK_WEIGHT;
                } else if (host.ozUSD && usdtry?.price) {
                    const gramUSD = host.ozUSD / OUNCE_TO_GRAM;
                    const gramTRY = gramUSD * usdtry.price;
                    gramSell = gramTRY; ceyrekSell = gramTRY * CEYREK_WEIGHT;
                }
                gramPct = null; ceyrekPct = null; // yedekte yüzde yok
            }
        }

        // Set percent changes and arrows
        setTrend('gram', gramPct);
        setTrend('ceyrek', ceyrekPct);
        setTrend('ons', xau?.changePct ?? null);
        setTrend('gumus', xag?.changePct ?? null);
        setTrend('usdtry', usdtry?.changePct ?? null);
        setTrend('eurtry', eurtry?.changePct ?? null);
        setTrend('eurusd', eurusd?.changePct ?? null);
        setTrend('gbptry', gbptry?.changePct ?? null);

        // Tick yönü okları (kısa süreli parıltı ile)
        setArrowFromTick('gram', gramSell);
        setArrowFromTick('ceyrek', ceyrekSell);
        setArrowFromTick('ons', xau?.price ?? null);
        setArrowFromTick('gumus', xag?.price ?? null);
        setArrowFromTick('usdtry', usdtry?.price ?? null);
        setArrowFromTick('eurtry', eurtry?.price ?? null);
        setArrowFromTick('eurusd', eurusd?.price ?? null);
        setArrowFromTick('gbptry', gbptry?.price ?? null);

    // Value lines
    setValue('gram', gramSell, 'TL');
    setValue('ceyrek', ceyrekSell, 'TL');
    setValue('ons', xau?.price ?? null, 'USD');
    setValue('gumus', xag?.price ?? null, 'USD');
    setValue('usdtry', usdtry?.price ?? null, 'TL');
    setValue('eurtry', eurtry?.price ?? null, 'TL');
    setValue('eurusd', eurusd?.price ?? null, 'USD');
    setValue('gbptry', gbptry?.price ?? null, 'TL');

        // Dolar endeksi değeri
        const dxyEl = document.getElementById('dxy-value');
        if (dxyEl) {
            const val = dxy?.price != null ? dxy.price.toFixed(2) : '';
            const pct = dxy?.changePct != null ? ` (%${trPercent(Math.abs(dxy.changePct))})` : '';
            dxyEl.textContent = dxy?.price != null ? `${val}${pct}` : '';
        }

        // Persist last tick
        try { localStorage.setItem(lastTickKey, JSON.stringify(lastTick)); } catch {}

        // Snapshot: son durumu sakla
        const snapshot = {
            gram: { 
                pct: gramPct, 
                val: gramSell, 
                unit: 'TL', 
                dir: document.getElementById('arrow-gram')?.className.includes('up') ? 'up' : document.getElementById('arrow-gram')?.className.includes('down') ? 'down' : null,
                ribbonClass: gramPct >= 0 ? 'green' : gramPct < 0 ? 'red' : null
            },
            ceyrek: { 
                pct: ceyrekPct, 
                val: ceyrekSell, 
                unit: 'TL', 
                dir: document.getElementById('arrow-ceyrek')?.className.includes('up') ? 'up' : document.getElementById('arrow-ceyrek')?.className.includes('down') ? 'down' : null,
                ribbonClass: ceyrekPct >= 0 ? 'green' : ceyrekPct < 0 ? 'red' : null
            },
            ons: { 
                pct: xau?.changePct, 
                val: xau?.price, 
                unit: 'USD', 
                dir: document.getElementById('arrow-ons')?.className.includes('up') ? 'up' : document.getElementById('arrow-ons')?.className.includes('down') ? 'down' : null,
                ribbonClass: xau?.changePct >= 0 ? 'green' : xau?.changePct < 0 ? 'red' : null
            },
            gumus: { 
                pct: xag?.changePct, 
                val: xag?.price, 
                unit: 'USD', 
                dir: document.getElementById('arrow-gumus')?.className.includes('up') ? 'up' : document.getElementById('arrow-gumus')?.className.includes('down') ? 'down' : null,
                ribbonClass: xag?.changePct >= 0 ? 'green' : xag?.changePct < 0 ? 'red' : null
            },
            usdtry: { 
                pct: usdtry?.changePct, 
                val: usdtry?.price, 
                unit: 'TL', 
                dir: document.getElementById('arrow-usdtry')?.className.includes('up') ? 'up' : document.getElementById('arrow-usdtry')?.className.includes('down') ? 'down' : null,
                ribbonClass: usdtry?.changePct >= 0 ? 'green' : usdtry?.changePct < 0 ? 'red' : null
            },
            eurtry: { 
                pct: eurtry?.changePct, 
                val: eurtry?.price, 
                unit: 'TL', 
                dir: document.getElementById('arrow-eurtry')?.className.includes('up') ? 'up' : document.getElementById('arrow-eurtry')?.className.includes('down') ? 'down' : null,
                ribbonClass: eurtry?.changePct >= 0 ? 'green' : eurtry?.changePct < 0 ? 'red' : null
            },
            eurusd: { 
                pct: eurusd?.changePct, 
                val: eurusd?.price, 
                unit: 'USD', 
                dir: document.getElementById('arrow-eurusd')?.className.includes('up') ? 'up' : document.getElementById('arrow-eurusd')?.className.includes('down') ? 'down' : null,
                ribbonClass: eurusd?.changePct >= 0 ? 'green' : eurusd?.changePct < 0 ? 'red' : null
            },
            gbptry: { 
                pct: gbptry?.changePct, 
                val: gbptry?.price, 
                unit: 'TL', 
                dir: document.getElementById('arrow-gbptry')?.className.includes('up') ? 'up' : document.getElementById('arrow-gbptry')?.className.includes('down') ? 'down' : null,
                ribbonClass: gbptry?.changePct >= 0 ? 'green' : gbptry?.changePct < 0 ? 'red' : null
            },
            dxy: dxy?.price != null ? `${dxy.price.toFixed(2)}${dxy?.changePct != null ? ` (%${trPercent(Math.abs(dxy.changePct))})` : ''}` : ''
        };
        saveSnapshot(snapshot);
        updateTimestamp();
    } catch (error) {
        console.error('Error fetching rates:', error);
        // Hata durumunda tire yerine boş bırak (snapshot varsa onu göstermeye devam et)
    }
}

// Snapshot restore: anlık gösterim için son veriyi localStorage'dan yükle
const snapshotKey = 'kur_snapshot_v1';
function saveSnapshot(data) {
    try { localStorage.setItem(snapshotKey, JSON.stringify(data)); } catch {}
}
function loadSnapshot() {
    try {
        const raw = localStorage.getItem(snapshotKey);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}

// Sayfa açılır açılmaz son snapshot'ı göster (veri gelene kadar)
const snap = loadSnapshot();
if (snap) {
    Object.entries(snap).forEach(([k, v]) => {
        if (v.pct != null) setTrend(k, v.pct);
        if (v.val != null) setValue(k, v.val, v.unit);
        if (v.dir && document.getElementById(`arrow-${k}`)) {
            document.getElementById(`arrow-${k}`).className = `arrow ${v.dir}`;
        }
        // Ribbon rengini de restore et
        if (v.ribbonClass && document.getElementById(`ribbon-${k}`)) {
            const ribbon = document.getElementById(`ribbon-${k}`);
            ribbon.className = `ribbon ${v.ribbonClass}`;
        }
    });
    if (snap.dxy) {
        const el = document.getElementById('dxy-value');
        if (el) el.textContent = snap.dxy;
    }
}

// Gerçek verileri çek ve sürekli güncelle
fetchRates();
setInterval(fetchRates, 60000); // Her 1 dakikada bir güncelle (optimal frekans)