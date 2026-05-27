// eslint.config.js — flat config (ESLint 9+)
// Minimal, opinion-free baseline: catches dead code and common bugs,
// stays out of the way of stylistic decisions (Prettier owns those).
module.exports = [
  {
    ignores: ["node_modules/**", "uploads/**", "coverage/**", "dist/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        global: "readonly",
        exports: "writable",
      },
    },
    rules: {
      // Correctness
      "no-undef": "error",
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-redeclare": "error",
      "no-unsafe-finally": "error",

      // Tenant-isolation hygiene: we keep these as warnings so the
      // initial run doesn't fail CI, but they nudge us toward fixes.
      "no-console": "off", // backend uses console.warn for ops signal
      eqeqeq: ["warn", "smart"],
      "no-implicit-coercion": "warn",
    },
  },
];
