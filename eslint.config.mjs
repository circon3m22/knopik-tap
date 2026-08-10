import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Гидрация сохранения из localStorage и захват длительности таймера
      // усталости — намеренные effect-паттерны легаси-кода: синхронный
      // setState в эффекте здесь безопасен (зависимости стабильны, значения
      // идемпотентны). Новое правило react-hooks помечает их ошибкой, но
      // переписывание гидрации рискованнее, чем предупреждение.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
