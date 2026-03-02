'use strict';

const puppeteer = require('puppeteer');
const config = require('./src/config');
const fs = require('fs');

async function main() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        await page.goto(config.baseUrl, { waitUntil: 'networkidle2' });

        await page.waitForSelector('input[name="username"], input[id="username"]');
        await page.type('input[name="username"], input[id="username"]', config.username);
        await page.type('input[name="password"], input[id="password"]', config.password);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button.button3, button[type="submit"], input[type="submit"]'),
        ]);

        const url = `${config.baseUrl}/reservations/2026-3-8/sport/841`;
        await page.goto(url, { waitUntil: 'networkidle2' });

        await page.waitForSelector('table.matrix', { timeout: 10000 });

        const resourceId = '2616'; // Padel 2
        const startTime = '11:00';

        const timestamp = await page.evaluate((startTime) => {
            const row = document.querySelector(`tr[data-time="${startTime}"]`);
            return row ? row.getAttribute('utc') : null;
        }, startTime);

        console.log('Timestamp found:', timestamp);

        if (timestamp) {
            const directUrl = `${config.baseUrl}/reservations/make/${resourceId}/${timestamp}`;
            console.log('Navigating to', directUrl);
            await page.goto(directUrl, { waitUntil: 'networkidle2' });

            await new Promise(r => setTimeout(r, 2000));

            // Wait for modal or form
            const hasForm = await page.evaluate(() => {
                return !!document.querySelector('#reservation-form, form[id*="reservation"], .modal');
            });
            console.log('Has reservation form:', hasForm);

            const html = await page.content();
            fs.writeFileSync('debug_direct.html', html);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await browser.close();
    }
}

main();
