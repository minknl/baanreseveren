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
        console.log('Navigating to login...');
        await page.goto(config.baseUrl, { waitUntil: 'networkidle2' });

        await page.waitForSelector('input[name="username"], input[id="username"]');
        await page.type('input[name="username"], input[id="username"]', config.username);
        await page.type('input[name="password"], input[id="password"]', config.password);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button.button3, button[type="submit"], input[type="submit"]'),
        ]);
        console.log('Logged in.');

        const url = `${config.baseUrl}/reservations/2026-3-8/sport/841`;
        console.log('Going to', url);
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Wait a bit
        await new Promise(r => setTimeout(r, 2000));

        console.log('Taking screenshot...');
        await page.screenshot({ path: 'debug_page.png', fullPage: true });

        console.log('Saving HTML...');
        const html = await page.content();
        fs.writeFileSync('debug_page.html', html);

        console.log('Done.');

    } catch (err) {
        console.error(err);
    } finally {
        await browser.close();
    }
}

main();
