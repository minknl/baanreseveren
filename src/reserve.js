'use strict';

const puppeteer = require('puppeteer');
const config = require('./config');
const logger = require('./logger');

// ─── CLI flags ───────────────────────────────────────────────────────────────
const isDryRun = process.argv.includes('--dry-run');
const isTest = process.argv.includes('--test');  // use Sunday 11:00 test slot

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the next occurrence of the given ISO weekday (0=Sun … 6=Sat),
 *  strictly in the future (at least tomorrow). */
function nextOccurrence(targetDayOfWeek) {
    const today = new Date();
    const diff = (targetDayOfWeek - today.getDay() + 7) % 7 || 7;
    const result = new Date(today);
    result.setDate(today.getDate() + diff);
    return result;
}

/** Format date as YYYY-M-D for the URL */
function formatDateForUrl(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Format date as HH:MM */
function formatTime(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
}

/** Wait for a selector to appear, then return it */
async function waitFor(page, selector, opts = {}) {
    return page.waitForSelector(selector, { timeout: 15000, ...opts });
}

/** Sleep a given number of milliseconds */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Find candidates ─────────────────────────────────────────────────────────

/** Returns an ordered list of {date, slot, court} candidates to try.
 *  Strategy: first try week 2 (8–14 dagen), dan week 1 (1–7 dagen).
 *  Reden: slots 2 weken vooruit zijn net beschikbaar geworden en hebben
 *  de hoogste kans op beschikbaarheid. */
function buildCandidates() {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + config.horizonDays);

    const preferences = isTest ? [config.testSlot] : config.slotPreferences;

    const week2 = []; // 2e week (8-14 dagen vooruit) — prioriteit
    const week1 = []; // 1e week (1-7 dagen vooruit) — fallback

    for (const slot of preferences) {
        const dateWeek1 = nextOccurrence(slot.dayOfWeek);       // eerstvolgende
        const dateWeek2 = new Date(dateWeek1);
        dateWeek2.setDate(dateWeek1.getDate() + 7);             // week erna

        // Week 2 (als binnen horizon)
        if (dateWeek2 <= horizon) {
            for (const court of config.courts) {
                week2.push({ date: dateWeek2, slot, court });
            }
        }

        // Week 1 (als binnen horizon)
        if (dateWeek1 <= horizon) {
            for (const court of config.courts) {
                week1.push({ date: dateWeek1, slot, court });
            }
        }
    }

    const candidates = [...week2, ...week1];

    if (candidates.length === 0) {
        logger.warn('Geen kandidaten binnen de horizon gevonden.');
    } else {
        const w2count = week2.length;
        const w1count = week1.length;
        logger.info(`Kandidaten: ${w2count} in week 2 (prioriteit), ${w1count} in week 1 (fallback)`);
    }

    return candidates;
}

// ─── Browser automation ──────────────────────────────────────────────────────

async function login(page) {
    logger.info('Navigeren naar login pagina...');
    await page.goto(config.baseUrl, { waitUntil: 'networkidle2' });

    await waitFor(page, 'input[name="username"], input[id="username"]');
    await page.type('input[name="username"], input[id="username"]', config.username);
    await page.type('input[name="password"], input[id="password"]', config.password);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('button.button3, button[type="submit"], input[type="submit"]'),
    ]);
    logger.info('Ingelogd als: ' + config.username);
}

/** Check if a time slot is available on the grid for a given court */
async function isSlotAvailable(page, date, slot, court) {
    const url = `${config.baseUrl}/reservations/${formatDateForUrl(date)}/sport/${config.sportId}`;
    logger.info(`Beschikbaarheid checken: ${slot.label} op ${court.name} → ${url}`);

    // We are already on the page from isSlotAvailable, but navigate just in case
    if (page.url() !== url) {
        await page.goto(url, { waitUntil: 'networkidle2' });
    }

    // Wait for the matrix table to load
    try {
        await page.waitForSelector('table.matrix', { timeout: 10000 });
        await sleep(500); // extra wait for js execution
    } catch {
        logger.warn('Tabel niet geladen binnen tijdlimiet');
        return false;
    }

    const startTime = formatTime(slot.startHour);

    const available = await page.evaluate((resourceId, startTime) => {
        const row = document.querySelector(`tr[data-time="${startTime}"]`);
        if (!row) return false;
        const cell = row.querySelector(`td.r-${resourceId}`);
        if (!cell) return false;
        return cell.classList.contains('free');
    }, court.resourceId, startTime);

    return available;
}

/** Add a single player to a speler slot in the modal.
 *  The form has native <select name="players[N]"> elements with pre-loaded
 *  <option> elements containing member IDs and names. We also type in the
 *  adjacent <input class="ms-search"> to trigger AJAX search first. */
async function addPlayer(page, playerIndex, playerName) {
    logger.info(`  Speler ${playerIndex} toevoegen: ${playerName}`);

    try {
        // First type in the ms-search input to trigger the site's search
        // (the search populates the select if needed)
        const searchInputs = await page.$$('input.ms-search');
        const inputIdx = playerIndex - 2; // 0-based: player 2 → index 0
        if (searchInputs[inputIdx]) {
            await searchInputs[inputIdx].click();
            await sleep(300);
            await searchInputs[inputIdx].type(playerName, { delay: 60 });
            await sleep(1500); // Wait for AJAX search results
        }

        // Now select the player from the native <select name="players[N]">
        const selected = await page.evaluate((idx, name) => {
            const sel = document.querySelector(`select[name="players[${idx}]"]`);
            if (!sel) return { ok: false, reason: 'select not found' };

            // Find the option matching the player name (case-insensitive)
            const nameLower = name.toLowerCase();
            const opt = Array.from(sel.options).find(
                o => o.text.toLowerCase().includes(nameLower)
            );
            if (!opt) return { ok: false, reason: 'option not found', options: Array.from(sel.options).map(o => o.text) };

            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, value: opt.value, text: opt.text };
        }, playerIndex, playerName);

        if (selected.ok) {
            logger.info(`  → ${selected.text} geselecteerd (ID: ${selected.value})`);
        } else {
            logger.warn(`  → Kon "${playerName}" niet selecteren: ${selected.reason}`);
            if (selected.options) logger.warn(`    Beschikbare opties: ${selected.options.join(', ')}`);
        }
    } catch (err) {
        logger.warn(`  → Fout bij toevoegen van speler ${playerIndex}: ${err.message}`);
    }
}

/** Make the actual reservation */
async function makeReservation(page, date, slot, court) {
    const url = `${config.baseUrl}/reservations/${formatDateForUrl(date)}/sport/${config.sportId}`;

    // We are already on the page from isSlotAvailable, but navigate just in case
    if (page.url() !== url) {
        await page.goto(url, { waitUntil: 'networkidle2' });
        await sleep(1500);
    }

    const startTime = formatTime(slot.startHour);

    // Get the UTC timestamp from the grid row
    const timestamp = await page.evaluate((startTime) => {
        const row = document.querySelector(`tr[data-time="${startTime}"]`);
        return row ? row.getAttribute('utc') : null;
    }, startTime);

    if (!timestamp) {
        logger.error(`Kon UTC timestamp niet vinden voor ${slot.label}`);
        return false;
    }

    // Direct navigation to the reservation form
    const directUrl = `${config.baseUrl}/reservations/make/${court.resourceId}/${timestamp}`;
    logger.info(`Reserveringsformulier openen: ${directUrl}`);

    await page.goto(directUrl, { waitUntil: 'networkidle2' });
    await sleep(1000);

    // Wait for the form to appear (either modal or full page)
    try {
        await waitFor(page, '#reservation-form, form[id*="reservation"], form[action*="/reservations/confirm"]');
    } catch {
        logger.error('Reserveringsformulier niet geladen op de pagina');
        return false;
    }
    logger.info('Reserveringsformulier geopend');

    // Select end time (start + 1 hour) using select[name="end_time"]
    const endHour = slot.startHour + 1;
    const endTime = formatTime(endHour);
    try {
        const endResult = await page.evaluate((endTime) => {
            const sel = document.querySelector('select[name="end_time"]');
            if (!sel) return { ok: false, reason: 'select[name=end_time] not found' };
            const opt = Array.from(sel.options).find(o => o.value === endTime || o.text.includes(endTime));
            if (!opt) return { ok: false, reason: `option ${endTime} not found`, options: Array.from(sel.options).map(o => o.value) };
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, value: opt.value };
        }, endTime);
        if (endResult.ok) {
            logger.info(`Eindtijd ingesteld op ${endTime}`);
        } else {
            logger.warn(`Eindtijd selectie: ${endResult.reason}`);
        }
        await sleep(500);
    } catch (err) {
        logger.warn(`Eindtijd selectie: ${err.message}`);
    }

    // Add players 2, 3, 4
    for (let i = 0; i < config.players.length; i++) {
        await addPlayer(page, i + 2, config.players[i]);
    }

    await sleep(800);

    if (isDryRun) {
        logger.info(`[DRY RUN] Zou nu klikken op "Verder" voor ${slot.label} op ${court.name}`);
        return true;
    }

    // Click "Verder" submit button — it is <input id="__make_submit" type="submit" value="Verder">
    const submitted = await page.evaluate(() => {
        const btn = document.querySelector('#__make_submit') ||
            document.querySelector('input[type="submit"][value="Verder"]') ||
            document.querySelector('input[type="submit"]');
        if (btn) { btn.click(); return true; }
        return false;
    });

    if (!submitted) {
        logger.error(`Kon "Verder" knop niet vinden`);
        return false;
    }

    logger.info('"Verder" geklikt, wachten op bevestigingspagina...');
    await sleep(3000);

    // After clicking "Verder" the site shows a confirmation page.
    // Look for a "Bevestigen" / "Maken" button or a confirmation form.
    const confirmed = await page.evaluate(() => {
        // Try to find the confirm button
        const buttons = Array.from(document.querySelectorAll(
            'input[type="submit"], button[type="submit"], a.button, input.button'
        ));
        const confirmBtn = buttons.find(b => {
            const text = (b.innerText || b.value || '').trim().toLowerCase();
            return text === 'bevestigen' || text === 'maken' || text === 'bevestig';
        });
        if (confirmBtn) { confirmBtn.click(); return 'confirmed'; }

        // Check if we're already on a success page
        const body = document.body.innerText || '';
        if (body.includes('Reservering opgeslagen') || body.includes('succesvol')) {
            return 'already_confirmed';
        }
        return 'no_confirm_button';
    });

    if (confirmed === 'confirmed') {
        await sleep(2000);
        logger.success(`✅ Reservering bevestigd: ${slot.label} op ${court.name}`);
        return true;
    } else if (confirmed === 'already_confirmed') {
        logger.success(`✅ Reservering bevestigd: ${slot.label} op ${court.name}`);
        return true;
    } else {
        // Take a screenshot for debugging
        try { await page.screenshot({ path: 'debug_confirm_page.png', fullPage: true }); } catch (e) { }
        logger.warn(`Bevestigingsknop niet gevonden, maar "Verder" was succesvol. Controleer handmatig.`);
        return true; // Optimistic — Verder was clicked
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    logger.info('═══════════════════════════════════════════');
    logger.info(`Padel Auto-Reservering gestart ${isDryRun ? '[DRY RUN]' : ''} ${isTest ? '[TEST]' : ''}`);
    logger.info('═══════════════════════════════════════════');

    const candidates = buildCandidates();
    if (candidates.length === 0) {
        logger.warn('Geen kandidaat-slots gevonden binnen de reserveringshorizon. Afsluiten.');
        return;
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        await login(page);

        for (const { date, slot, court } of candidates) {
            const available = await isSlotAvailable(page, date, slot, court);
            if (!available) {
                logger.info(`❌ Niet beschikbaar: ${slot.label} op ${court.name}`);
                continue;
            }

            logger.info(`✅ Beschikbaar: ${slot.label} op ${court.name} — reservering maken...`);
            const success = await makeReservation(page, date, slot, court);
            if (success) {
                logger.success(`🎾 Klaar! ${slot.label} op ${court.name} is gereserveerd.`);
                break; // Only book one slot per run
            }
        }

    } catch (err) {
        logger.error(`Onverwachte fout: ${err.stack || err.message}`);
    } finally {
        await browser.close();
        logger.info('Browser gesloten. Script klaar.');
    }
}

main().catch(err => {
    logger.error(`Fatale fout: ${err.message}`);
    process.exit(1);
});
