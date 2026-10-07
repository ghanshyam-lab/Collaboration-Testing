export type Sample = {
  user: string;
  operation: string;
  durationMs: number;
  ok: boolean;
  error?: string;
};

export type StressSummary = {
  timestamp: string;
  presentation: string;
  virtualUsers: number;
  durationMs: number;
  totals: { operations: number; successful: number; failed: number };
  errorRate: number;
  latencyMs: { min: number; average: number; p90: number; p95: number; p99: number; max: number };
  runtimeErrors: Array<{ user: string; kind: string; message: string }>;
  samples: Sample[];
};

export function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export async function measure(
  samples: Sample[],
  user: string,
  operation: string,
  action: () => Promise<void>,
) {
  const started = performance.now();
  try {
    await action();
    samples.push({ user, operation, durationMs: performance.now() - started, ok: true });
    return true;
  } catch (error) {
    samples.push({ user, operation, durationMs: performance.now() - started, ok: false, error: String(error) });
    return false;
  }
}

export function createStressSummary(options: {
  presentation: string;
  virtualUsers: number;
  durationMs: number;
  samples: Sample[];
  runtimeErrors: StressSummary['runtimeErrors'];
}): StressSummary {
  const { presentation, virtualUsers, durationMs, samples, runtimeErrors } = options;
  const successful = samples.filter(sample => sample.ok);
  const failed = samples.filter(sample => !sample.ok);
  const durations = successful.map(sample => sample.durationMs);

  return {
    timestamp: new Date().toISOString(),
    presentation,
    virtualUsers,
    durationMs,
    totals: { operations: samples.length, successful: successful.length, failed: failed.length },
    errorRate: samples.length ? failed.length / samples.length : 1,
    latencyMs: {
      min: durations.length ? Math.min(...durations) : 0,
      average: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      p90: percentile(durations, 0.90),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: durations.length ? Math.max(...durations) : 0,
    },
    runtimeErrors,
    samples,
  };
}
