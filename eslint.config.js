const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-console": "off",
      "no-undef": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-prototype-builtins": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "preserve-caught-error": "off",
      "no-useless-assignment": "warn",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    ignores: [
      "node_modules/",
      "public/vendor/",
      "public/models/",
      "downloads/",
      "store/",
      "venv/",
      "scratch/",
      ".venv/",
    ],
  },
];
