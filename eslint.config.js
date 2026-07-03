import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Frontend lint. Rust lives in src-tauri and is linted by cargo, not here.
// tsc (strict) remains the type gate; ESLint adds what tsc can't see —
// notably react-hooks dependency checking.
export default tseslint.config(
  { ignores: ["dist", "src-tauri", ".claude"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      // This project doesn't use the React Compiler; its "incompatible library"
      // advisories (e.g. TanStack Virtual's useVirtualizer) are noise here.
      // Keep the classic value: rules-of-hooks + exhaustive-deps.
      "react-hooks/incompatible-library": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
