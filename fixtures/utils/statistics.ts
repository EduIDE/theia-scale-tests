function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function assertNonEmpty(values: number[], fnName: string): void {
  if (values.length === 0) {
    throw new Error(`${fnName} requires at least one value`);
  }
}

export function median(values: number[]): number {
  assertNonEmpty(values, "median");
  const arr = sorted(values);
  const middle = Math.floor(arr.length / 2);

  if (arr.length % 2 === 0) {
    return (arr[middle - 1] + arr[middle]) / 2;
  }

  return arr[middle];
}

export function p95(values: number[]): number {
  assertNonEmpty(values, "p95");
  const arr = sorted(values);
  const index = Math.ceil(0.95 * arr.length) - 1;
  const boundedIndex = Math.min(Math.max(index, 0), arr.length - 1);

  return arr[boundedIndex];
}

export function avg(values: number[]): number {
  assertNonEmpty(values, "avg");
  const sum = values.reduce((acc, curr) => acc + curr, 0);
  return sum / values.length;
}

export function max(values: number[]): number {
  assertNonEmpty(values, "max");
  return Math.max(...values);
}
