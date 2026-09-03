"use client";

import { buildCalendarLinks, buildIcsEvent, type PortableCalendarEvent } from "../lib/calendar-event";

export function AddToCalendar({ event, compact = false }: { event: PortableCalendarEvent; compact?: boolean }) {
  const links = buildCalendarLinks(event);
  const downloadIcs = () => {
    const file = buildIcsEvent(event);
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return <details className={`add-to-calendar ${compact ? "compact" : ""}`}>
    <summary>Add to calendar <span aria-hidden="true">⌄</span></summary>
    <div className="add-to-calendar-menu">
      <a href={links.google} target="_blank" rel="noreferrer"><strong>Google Calendar</strong><small>Open this appointment</small></a>
      <a href={links.outlook} target="_blank" rel="noreferrer"><strong>Outlook Calendar</strong><small>Open this appointment</small></a>
      <button type="button" onClick={downloadIcs}><strong>Apple or another app</strong><small>Download one calendar event</small></button>
    </div>
  </details>;
}
