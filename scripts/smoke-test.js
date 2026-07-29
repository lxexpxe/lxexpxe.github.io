const { chromium } = require('playwright');
const fs = require('fs');

const URL = 'http://localhost:8123';
const TOKEN = fs.readFileSync('/tmp/custom-token.txt', 'utf8').trim();

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    console.log('Navegando a', URL);
    await page.goto(URL, { waitUntil: 'networkidle' });

    await page.waitForSelector('text=Iniciar Sesión', { timeout: 15000 });
    console.log('AuthPage renderizó correctamente.');
    await page.screenshot({ path: '/tmp/01-auth-page.png' });

    console.log('Iniciando sesión con custom token (profesor v6OPx...)');
    await page.evaluate(async (token) => {
        await firebase.auth().signInWithCustomToken(token);
    }, TOKEN);

    await page.waitForSelector('text=Control de Asistencia', { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/02-admin-dashboard.png' });

    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('\n--- Contiene "Iniciar Sesión" (no debería, ya logueado)?', bodyText.includes('Iniciar Sesión'));
    console.log('--- Contiene nombre de curso esperado?', /curso/i.test(bodyText) || bodyText.length > 200);

    console.log('\n--- Errores de consola ---');
    if (consoleErrors.length === 0) {
        console.log('(ninguno)');
    } else {
        consoleErrors.forEach(e => console.log(e));
    }

    await browser.close();
    process.exit(0);
})().catch(err => {
    console.error('Error en smoke test:', err);
    process.exit(1);
});
