import { test, expect } from "@playwright/test";
import { median, p95, avg, max } from "../../../fixtures/utils/statistics";

test("median computes odd/even correctly", async () => {
  expect(median([1, 3, 2])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
});

test("p95 computes deterministic percentile", async () => {
  expect(p95([100, 120, 130, 140, 1000])).toBe(1000);
});

test("avg computes arithmetic mean", async () => {
  expect(avg([1, 2, 3, 4])).toBe(2.5);
});

test("max computes largest value", async () => {
  expect(max([10, 2, 17, 3])).toBe(17);
});
