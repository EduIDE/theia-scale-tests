// @ts-check

import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { includeIgnoreFile } from "@eslint/compat";
import tseslint from "typescript-eslint";
import globals from "globals";
import path from "path";

const gitignorePath = path.resolve(".gitignore");

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  includeIgnoreFile(gitignorePath),
  globalIgnores(["pages/ide/theia-pom"]),
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
