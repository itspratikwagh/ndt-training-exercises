const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + require('path').resolve(__dirname, '../../RT-Dose-Limits-Animation.html') + '?record');
  console.log(JSON.stringify(await p.evaluate(() => window.__narration)));
  await b.close();
})();
