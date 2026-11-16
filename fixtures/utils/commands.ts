import { Page } from "@playwright/test";

const isMac = process.platform === "darwin";
const modifierKey = isMac ? "Meta" : "Control";

export const pasteFromString = async (page: Page, text: string) => {
  // Awaited inside the page: Ctrl+V before the write finished pasted old content.
  await page.evaluate(async (content) => {
    await navigator.clipboard.writeText(content);
  }, text);
  await page.keyboard.press(`${modifierKey}+V`);
};

export const deleteAll = async (page: Page) => {
  await page.keyboard.press(`${modifierKey}+A`);
  await page.keyboard.press("Delete");
};

export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const getRandomWord = (text: string): string | null => {
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * words.length);
  return words[randomIndex];
};
