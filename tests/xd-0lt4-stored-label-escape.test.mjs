// xd-0lt.4 — DB-derived labels are escaped at three innerHTML sinks, and the
// CSP pins form-action to self (security audit run-1).
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAYLOAD = '<img src=x onerror=alert(1)>';

function el() { return { innerHTML: '', style: {}, textContent: '' }; }
function installDom(els) {
  globalThis.document = { getElementById: (id) => els[id] || null };
  globalThis.window = globalThis.window || { innerWidth: 1200 };
}
afterEach(() => { delete globalThis.document; });

const { App } = await import('../js/app.js');
const { Explorer } = await import('../js/explorer.js');
const { Charts } = await import('../js/charts.js');
const { Filters } = await import('../js/filters.js');
const { CONFIG } = await import('../js/config.js');
const { DemoMode } = await import('../js/demoMode.js');

describe('xd-0lt.4 stored-label escaping', () => {
  it('explorer legend escapes the dataset label', () => {
    const legend = el();
    installDom({ explorerLegend_1: legend });
    Charts.instances.cx = {
      data: { datasets: [{ label: PAYLOAD, borderColor: '#fff' }] },
      getDatasetMeta: () => ({ hidden: false }),
    };
    try { Explorer._renderSlotLegend({ id: 1 }, 'cx'); } finally { delete Charts.instances.cx; }
    assert.ok(!legend.innerHTML.includes('<img'), legend.innerHTML);
    assert.ok(legend.innerHTML.includes('&lt;img'));
  });

  it('vintage x varietal table escapes the variety', () => {
    const body = el(); const head = el();
    installDom({ 'vintage-varietal-body': body, 'vintage-varietal-head': head });
    App.updateVintageVarietalTable([{ variety: PAYLOAD, vintage: 2025, brix: 22, pH: 3.4, tANT: 100, ta: 6 }]);
    assert.ok(!body.innerHTML.includes('<img'), body.innerHTML);
    assert.ok(body.innerHTML.includes('&lt;img'));
  });

  it('extraction table escapes lot codes, variety and appellation', () => {
    const body = el();
    installDom({ 'extraction-table-body': body });
    const saved = { m: CONFIG.berryToWine, f: Filters.getFiltered, w: Filters.getFilteredWine, v: Charts._wineCodeVintage, d: DemoMode.isActive };
    CONFIG.berryToWine = { [PAYLOAD]: ['W1'] };
    Filters.getFiltered = () => [{ sampleId: 's', tANT: 100, lotCode: PAYLOAD, vintage: 2025, variety: PAYLOAD, appellation: PAYLOAD }];
    Filters.getFilteredWine = () => [{ codigoBodega: 'W1', antoWX: 50 }];
    Charts._wineCodeVintage = () => 2025;
    DemoMode.isActive = () => true;
    try { App.updateExtractionTable(); } finally {
      CONFIG.berryToWine = saved.m; Filters.getFiltered = saved.f; Filters.getFilteredWine = saved.w;
      Charts._wineCodeVintage = saved.v; DemoMode.isActive = saved.d;
    }
    assert.ok(body.innerHTML.includes('<td'), 'rows rendered');
    assert.ok(!body.innerHTML.includes('<img'), body.innerHTML);
  });

  it('CSP sets form-action to self', () => {
    const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const csp = JSON.stringify(cfg);
    assert.match(csp, /form-action 'self'/);
  });
});
