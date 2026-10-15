/**
 * Public release notes for KNOPIK TAP, newest release first.
 *
 * Every player-facing patch must bump GAME_VERSION, package.json,
 * package-lock.json and the service worker cache name, and prepend
 * one short entry here. Keep descriptions brief and factual.
 *
 * @typedef {{ version: string, date: string, title: string, changes: readonly string[] }} GameRelease
 */

export const GAME_VERSION = "1.0.6";

/** @type {readonly GameRelease[]} */
export const RELEASES = [
  {
    version: "1.0.6",
    date: "2026-10-15",
    title: "Исправление активации промокодов",
    changes: [
      "Исправлена активация промокодов на другом устройстве и аккаунте: ошибка доступа Supabase устранена.",
      "Одноразовое начисление по-прежнему защищено от повторного использования.",
      "Сохранения других игроков и закрытые таблицы остаются недоступны.",
    ],
  },
  {
    version: "1.0.5",
    date: "2026-10-14",
    title: "Финальная полировка игры",
    changes: [
      "Сохранения в Supabase теперь отправляются регулярно даже во время долгой серии быстрых тапов.",
      "Улучшены повторы сетевых запросов и защита наград от пересечения с облачной синхронизацией.",
      "Обновлены плавность анимации сейфа, работа звука при сворачивании и отображение заполненных кейсов.",
      "Исправлены зависания входа при плохой связи и кеширование других игр на том же домене.",
    ],
  },
  {
    version: "1.0.4",
    date: "2026-10-14",
    title: "Настройки в стиле админ-панели",
    changes: [
      "Обычные настройки теперь открываются на отдельном полноэкранном экране.",
      "Обновлены заголовки, карточки, кнопки, переключатели и статистика.",
      "Добавлена заметная кнопка закрытия; все действия и защита сброса прогресса сохранены.",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-10-14",
    title: "Оптимизация для телефона",
    changes: [
      "Снижена нагрузка от фоновых анимаций и размытия на мобильных экранах.",
      "Уменьшено число визуальных частиц, звуков и вибраций при быстрых тапах — награды не меняются.",
      "Обновлено сохранение прогресса во время непрерывной игры и при сворачивании.",
      "Оптимизированы фоновые таймеры, ультра-тап и звуки слотов.",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-10-13",
    title: "Защита облачного прогресса",
    changes: [
      "Сохранения защищены от перезаписи устаревшей копией.",
      "Автоматическое повторение записи после обрывов связи.",
      "Локальная копия сохраняется до подтверждения загрузки в облако.",
      "История предыдущих сохранений хранится в Supabase.",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-10-13",
    title: "Панель администратора",
    changes: [
      "Отдельная админ-панель из профиля администратора.",
      "Управление сложностью и промокодами в одном месте.",
      "Быстрый переход между панелью и настройками.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-13",
    title: "Первый официальный релиз",
    changes: [
      "Тапы, ультра-тап, уровни и сейф.",
      "Магазин, рулетка, слоты, мины и кейсы.",
      "Облачные сохранения и профиль игрока.",
      "Уведомления об обновлениях и история патчей.",
    ],
  },
];

/** The version notice is remembered independently for each player on this device.
 * @param {string} userId
 */
export function releaseSeenKey(userId) {
  return `knopik-tap:seen-release:${userId}`;
}

/** Returns releases not yet seen, newest first.
 * If an older version isn't in our journal, show only the latest entry.
 * @param {string | null} lastSeenVersion
 * @returns {readonly GameRelease[]}
 */
export function releasesSince(lastSeenVersion) {
  if (lastSeenVersion === GAME_VERSION) return [];
  const index = RELEASES.findIndex((release) => release.version === lastSeenVersion);
  return index > 0 ? RELEASES.slice(0, index) : RELEASES.slice(0, 1);
}
