import { percentile, type StressSummary } from './stress-metrics';

export function createPerformanceReport(
  summary: StressSummary,
  p95Target: number,
  errorRateTarget: number,
) {
  const operations = [...new Set(summary.samples.map(sample => sample.operation))].map(operation => {
    const samples = summary.samples.filter(sample => sample.operation === operation);
    const durations = samples.filter(sample => sample.ok).map(sample => sample.durationMs);
    return {
      operation,
      count: samples.length,
      failures: samples.length - durations.length,
      average: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      p90: percentile(durations, 0.90),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
    };
  });
  const maximum = Math.max(summary.latencyMs.max, p95Target, 1);
  const bars = Object.entries({ Minimum: summary.latencyMs.min, Average: summary.latencyMs.average, p90: summary.latencyMs.p90, p95: summary.latencyMs.p95, p99: summary.latencyMs.p99, Maximum: summary.latencyMs.max })
    .map(([label, value]) => `<div class="bar"><span>${label}</span><i style="width:${Math.min(100, value / maximum * 100)}%"></i><strong>${value.toFixed(0)} ms</strong></div>`)
    .join('');
  const rows = operations
    .map(item => `<tr><td>${item.operation}</td><td>${item.count}</td><td>${item.failures}</td><td>${item.average.toFixed(0)} ms</td><td>${item.p90.toFixed(0)} ms</td><td>${item.p95.toFixed(0)} ms</td><td>${item.p99.toFixed(0)} ms</td></tr>`)
    .join('');
  const latencyPass = summary.latencyMs.p95 <= p95Target;
  const errorPass = summary.errorRate <= errorRateTarget;
  const rawData = JSON.stringify(summary).replaceAll('<', '\\u003c');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collaboration performance report</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#08111f;color:#e6edf7}body{max-width:1050px;margin:auto;padding:36px 24px}.muted{color:#91a4bd}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:28px 0}.card,.panel{background:#101d30;border:1px solid #233754;border-radius:14px;padding:20px}.value{font-size:28px;font-weight:750;margin-top:8px}.pass{color:#5ee6a8}.fail{color:#ff7185}.panel{margin:14px 0}.bar{display:grid;grid-template-columns:90px 1fr 90px;align-items:center;gap:12px;margin:15px 0}.bar:has(i){background:linear-gradient(90deg,#37b6ff,#8b72ff) no-repeat 90px center/var(--size) 12px}.bar i{height:12px;background:linear-gradient(90deg,#37b6ff,#8b72ff);border-radius:20px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px;border-bottom:1px solid #233754}</style></head><body>
  <h1>Collaboration performance</h1><div class="muted">${summary.presentation} · ${new Date(summary.timestamp).toLocaleString()} · ${summary.virtualUsers} virtual users</div>
  <div class="grid"><div class="card"><div class="muted">Operations</div><div class="value">${summary.totals.operations}</div></div><div class="card"><div class="muted">p95 latency</div><div class="value ${latencyPass ? 'pass' : 'fail'}">${summary.latencyMs.p95.toFixed(0)} ms</div><small>Target ≤ ${p95Target} ms</small></div><div class="card"><div class="muted">Error rate</div><div class="value ${errorPass ? 'pass' : 'fail'}">${(summary.errorRate * 100).toFixed(2)}%</div><small>Target ≤ ${(errorRateTarget * 100).toFixed(2)}%</small></div><div class="card"><div class="muted">Runtime errors</div><div class="value ${summary.runtimeErrors.length ? 'fail' : 'pass'}">${summary.runtimeErrors.length}</div></div></div>
  <section class="panel"><h2>Latency overview</h2>${bars}</section><section class="panel"><h2>By operation</h2><table><thead><tr><th>Operation</th><th>Count</th><th>Failures</th><th>Average</th><th>p90</th><th>p95</th><th>p99</th></tr></thead><tbody>${rows}</tbody></table></section>
  <script type="application/json" id="raw-data">${rawData}</script></body></html>`;
}
