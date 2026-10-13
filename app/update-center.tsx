"use client";

import { useEffect, useRef, useState } from "react";
import { GAME_VERSION, RELEASES, releaseSeenKey, releasesSince } from "./release-notes.js";

type UpdateCenterProps = {
  userId: string;
  /** Returning players see an update; brand-new players finish onboarding without a popup. */
  returningPlayer: boolean;
  canShowAnnouncement: boolean;
  historyOpen: boolean;
  onCloseHistory: () => void;
};

export function UpdateCenter({
  userId,
  returningPlayer,
  canShowAnnouncement,
  historyOpen,
  onCloseHistory,
}: UpdateCenterProps) {
  const [unread, setUnread] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isDialogOpen = historyOpen || detailsOpen;

  useEffect(() => {
    let previous: string | null = null;
    try {
      previous = window.localStorage.getItem(releaseSeenKey(userId));
    } catch {
      // The notice still works within this session when storage is blocked.
    }

    if (previous === null && !returningPlayer) {
      // Do not interrupt the first-time tutorial with an "updated" message.
      try {
        window.localStorage.setItem(releaseSeenKey(userId), GAME_VERSION);
      } catch {
        // Private browsing may disallow local storage.
      }
      setUnread(false);
      return;
    }
    setUnread(releasesSince(previous).length > 0);
  }, [userId, returningPlayer]);

  // Opening the journal directly from settings also counts as reading this release.
  useEffect(() => {
    if (!historyOpen) return;
    setUnread(false);
    try {
      window.localStorage.setItem(releaseSeenKey(userId), GAME_VERSION);
    } catch {
      // Preserve the in-memory dismissal if local storage is blocked.
    }
  }, [historyOpen, userId]);

  const markSeen = () => {
    setUnread(false);
    try {
      window.localStorage.setItem(releaseSeenKey(userId), GAME_VERSION);
    } catch {
      // Notification may reappear on a future visit if storage is disabled.
    }
  };

  const closeDialog = () => {
    setDetailsOpen(false);
    onCloseHistory();
  };

  const openDetails = () => {
    markSeen();
    setDetailsOpen(true);
  };

  useEffect(() => {
    if (!isDialogOpen) return;
    closeButtonRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailsOpen(false);
        onCloseHistory();
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isDialogOpen, onCloseHistory]);

  return (
    <>
      {unread && canShowAnnouncement && !isDialogOpen && (
        <div className="kn-release-notice" role="status" aria-label={`Игра обновлена до версии ${GAME_VERSION}`}>
          <span className="kn-release-notice-symbol" aria-hidden="true">↗</span>
          <div className="kn-release-notice-copy">
            <span>ОБНОВЛЕНИЕ ИГРЫ</span>
            <strong>Игра обновлена до версии {GAME_VERSION}</strong>
          </div>
          <button className="kn-release-notice-detail" type="button" onClick={openDetails}>Подробнее</button>
          <button className="kn-release-notice-dismiss" type="button" onClick={markSeen} aria-label="Скрыть уведомление об обновлении">×</button>
        </div>
      )}

      {isDialogOpen && (
        <div
          className="kn-release-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section className="kn-release-dialog" role="dialog" aria-modal="true" aria-labelledby="kn-release-title">
            <header className="kn-release-header">
              <div>
                <span className="kn-release-overline">KNOPIK TAP · ОБНОВЛЕНИЯ</span>
                <h2 id="kn-release-title">Что нового</h2>
                <p>Текущая версия: {GAME_VERSION}</p>
              </div>
              <button ref={closeButtonRef} className="kn-release-close" type="button" onClick={closeDialog} aria-label="Закрыть журнал обновлений">×</button>
            </header>
            <div className="kn-release-history">
              {RELEASES.map((release, index) => (
                <article className="kn-release-entry" key={release.version}>
                  <div className="kn-release-entry-header">
                    <span className="kn-release-version">v{release.version}{index === 0 ? " · ТЕКУЩАЯ" : ""}</span>
                    <time dateTime={release.date}>{new Date(`${release.date}T12:00:00`).toLocaleDateString("ru-RU")}</time>
                  </div>
                  <h3>{release.title}</h3>
                  <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul>
                </article>
              ))}
            </div>
            <button className="kn-release-primary" type="button" onClick={closeDialog}>Понятно</button>
          </section>
        </div>
      )}
    </>
  );
}
