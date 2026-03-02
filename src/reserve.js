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

/** Returns an ordered list of {date, slot, court} candidates to try */
function buildCandidates() {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + config.horizonDays);

    const preferences = isTest ? [config.testSlot] : config.slotPreferences;

    const candidates = [];
    for (const slot of preferences) {
        const date = nextOccurrence(slot.dayOfWeek);
        if (date > horizon) {
            logger.warn(`${slot.label}: te ver in de toekomst (buiten horizon), overgeslagen`);
            continue;
        }
        for (const court of config.courts) {
            candidates.push({ date, slot, court });
        }
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

/** Add a single player to a speler slot in the modal */
async function addPlayer(page, playerIndex, playerName) {
    // playerIndex is 2, 3, or 4 (Speler 2/3/4)
    logger.info(`  Speler ${playerIndex} toevoegen: ${playerName}`);

    // Click the search input for this player slot
    // The modal has select2 dropdowns for each player
    const searchSelectors = [
        `#speler_input_2`,
        `#speler_input_3`,
        `#speler_input_4`,
        // Fallback: find by position in ms-search inputs
    ];

    // Try to open the select2 dropdown for this player
    // select2 containers are usually li or div elements with class select2
    const playerDropdownSelector = `.player-${playerIndex}-select, #player-${playerIndex}, select[name*="speler"][name*="${playerIndex}"]`;

    // We use a more robust approach: find all select2 search inputs and pick by index
    const inputIndex = playerIndex - 2; // 0-based for players 2,3,4

    try {
        // Trigger the select2 dropdown for this player's field
        await page.evaluate((idx) => {
            // Find all select2 activation containers (spans or divs with select2)
            const containers = Array.from(document.querySelectorAll(
                '.select2-container, [class*="select2"]'
            )).filter(el => el.offsetParent !== null); // visible elements only

            // Filter to player-likely ones (skip court/date/time dropdowns at top)
            const playerContainers = containers.filter(el => {
                const parentText = (el.closest('tr, .form-group, li') || {}).innerText || '';
                return parentText.toLowerCase().includes('speler') ||
                    el.id.toLowerCase().includes('speler') ||
                    el.id.toLowerCase().includes('player');
            });

            if (playerContainers[idx]) {
                playerContainers[idx].click();
            } else {
                // Fallback: click any visible select2 container by index (skip first 2 for court/time)
                const allVisible = containers.filter(el => el.offsetParent !== null);
                // Usually first few are court/time selectors, players start from index 2 or 3
                const startIdx = allVisible.findIndex(el =>
                    (el.innerText || '').toLowerCase().includes('speler')
                );
                const targetIdx = startIdx >= 0 ? startIdx + idx : idx + 3;
                if (allVisible[targetIdx]) allVisible[targetIdx].click();
            }
        }, inputIndex);

        await sleep(600);

        // Type player name into the search box that appears
        const searchInput = await page.$('.select2-search__field, .select2-input');
        if (searchInput) {
            await searchInput.type(playerName, { delay: 80 });
            await sleep(1500); // Wait for AJAX results

            // Click the first matching result
            const result = await page.$('.select2-results__option, .select2-result');
            if (result) {
                await result.click();
                await sleep(400);
                logger.info(`  → ${playerName} geselecteerd`);
            } else {
                logger.warn(`  → Geen resultaat gevonden voor "${playerName}"`);
            }
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

    // Select end time (start + 1 hour)
    const endHour = slot.startHour + 1;
    const endTime = formatTime(endHour);
    try {
        await page.evaluate((endTime) => {
            const selects = Array.from(document.querySelectorAll('select'));
            const endSelect = selects.find(s => {
                const label = (s.labels || [])[0] || {};
                return (label.innerText || s.name || s.id).toLowerCase().includes('eindtijd');
            }) || selects.find(s => {
                const opts = Array.from(s.options);
                return opts.some(o => o.text.includes(endTime));
            });
            if (endSelect) {
                const opt = Array.from(endSelect.options).find(o => o.text.includes(endTime));
                if (opt) {
                    endSelect.value = opt.value;
                    endSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }, endTime);
        logger.info(`Eindtijd ingesteld op ${endTime}`);
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

    // Click "Verder" to submit
    const submitted = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
        const verder = buttons.find(b => (b.innerText || b.value || '').trim().toLowerCase() === 'verder');
        if (verder) { verder.click(); return true; }
        return false;
    });

    if (submitted) {
        await sleep(2000);
        logger.success(`✅ Reservering bevestigd: ${slot.label} op ${court.name}`);
        return true;
    } else {
        logger.error(`Kon "Verder" knop niet vinden`);
        return false;
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
