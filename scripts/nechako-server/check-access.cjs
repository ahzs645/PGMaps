const { chromium } = require('playwright');
const fs = require('node:fs');
const base = 'https://nechakowatershed-portal.ca/';
const path = require('node:path');
const out = path.resolve(process.env.NECHAKO_AUDIT_DIR || 'tmp/nechako-access-audit');
if (process.argv.includes('--help')) {
  console.log('Read-only browser login/data check. Set NECHAKO_USERNAME and NECHAKO_PASSWORD. Optional: NECHAKO_AUDIT_DIR, NECHAKO_CHROMIUM. Output defaults to ignored tmp/nechako-access-audit; do not commit protected exports.');
  process.exit(0);
}
if (!process.env.NECHAKO_USERNAME || !process.env.NECHAKO_PASSWORD) {
  console.error('Set NECHAKO_USERNAME and NECHAKO_PASSWORD for an explicitly authorized account.');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
async function main() {
  const browser = await chromium.launch({ ...(process.env.NECHAKO_CHROMIUM ? { executablePath: process.env.NECHAKO_CHROMIUM } : {}), headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      ...(process.env.HTTPS_PROXY ? [`--proxy-server=https=${process.env.HTTPS_PROXY}`] : [])] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const report = { checkedAt: new Date().toISOString(), origin: base, browserSecurityDisabled: false, errors, reads: [] };
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText('Login', { exact: true }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    report.startupText = await page.locator('body').innerText();
    console.log(JSON.stringify({ step: 'startup', text: report.startupText.slice(-2500) }));
    report.startupDialogs = await page.evaluate(() => Ext.ComponentQuery.query('window').filter(c => c.isVisible()).map(c => ({ title: c.title, modal: c.modal })));
    // Dismiss only startup windows, before any login form has been opened.
    await page.evaluate(() => Ext.ComponentQuery.query('window').filter(c => c.isVisible()).forEach(c => c.hide()));
    await page.getByText('Login', { exact: true }).first().click();
    await page.locator('input[type="password"]').waitFor();
    const fields = await page.locator('input:visible').evaluateAll(nodes => nodes.map(n => ({ id: n.id, type: n.type, placeholder: n.placeholder })));
    report.loginFields = fields;
    const password = page.locator('input[type="password"]:visible').first();
    // ExtJS labels are rendered separately; use their component identities.
    const ids = await page.evaluate(() => Ext.ComponentQuery.query('textfield').filter(c => c.isVisible() && ['Username','Password'].includes(c.fieldLabel)).map(c => ({ label: c.fieldLabel, inputId: c.inputId })));
    await page.locator('[id="' + ids.find(x => x.label === 'Username').inputId + '"]').fill(process.env.NECHAKO_USERNAME);
    await password.fill(process.env.NECHAKO_PASSWORD);
    const responsePromise = page.waitForResponse(r => r.url().includes('/rest/portal/login.php'), { timeout: 45000 });
    await password.press('Enter');
    const loginResponse = await responsePromise;
    const loginText = await loginResponse.text();
    let login; try { login = JSON.parse(loginText); } catch { login = { parseError: true, responsePreview: loginText.slice(0,1000) }; }
    // Never record credential request bodies, cookies or session identifiers.
    report.login = { httpStatus: loginResponse.status(), status: login.status, error: login.error,
      attributeKeys: login.attributes && typeof login.attributes === 'object' ? Object.keys(login.attributes) : [], responsePreview: login.responsePreview };
    console.log(JSON.stringify({ step: 'login', ...report.login }));
    await page.evaluate(() => document.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; }));
    await page.waitForTimeout(1500);
    report.visibleText = await page.locator('body').innerText();
    await page.screenshot({ path: `${out}/login-result.png`, fullPage: true });
    const checks = [
      ['rest/checkLoginStatus.php', {}],
      ['rest/portal/getSearchContext.php', { types: JSON.stringify(['metadata','content']) }],
      ['rest/openmap/savedProjects.php', { mode: 'list' }],
      ['rest/openmap/getDefaultProject.php', {}],
      ['rest/portal/getForms.php', { page: '1', start: '0', limit: '25' }],
    ];
    for (const [endpoint, fields] of checks) {
      const result = await page.evaluate(async ({ endpoint, fields }) => {
        const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams(fields), credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
        const body = await response.text();
        let data; try { data = JSON.parse(body); } catch { data = { parseError: true, preview: body.slice(0,1000) }; }
        return { endpoint, httpStatus: response.status, data, bytes: new TextEncoder().encode(body).length };
      }, { endpoint, fields });
      report.reads.push(result);
      console.log(JSON.stringify({ endpoint, httpStatus: result.httpStatus, status: result.data.status, error: result.data.error, bytes: result.bytes }));
    }
  } finally {
    if (!report.visibleText) report.visibleText = await page.locator('body').innerText().catch(() => '');
    await page.screenshot({ path: `${out}/login-result.png`, fullPage: true }).catch(() => {});
    fs.writeFileSync(`${out}/read-access-audit.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
    await browser.close();
  }
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
