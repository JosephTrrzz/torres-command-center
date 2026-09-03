export interface PortableCalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  description?: string;
  location?: string;
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventDates(event: PortableCalendarEvent) {
  const start = validDate(event.startsAt);
  if (!start) throw new Error("This appointment does not have a valid start time.");
  const requestedEnd = event.endsAt ? validDate(event.endsAt) : null;
  const end = requestedEnd && requestedEnd > start ? requestedEnd : new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

function compactUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value = "") {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function fileName(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
  return `${safe || "appointment"}.ics`;
}

export function buildCalendarLinks(event: PortableCalendarEvent) {
  const { start, end } = eventDates(event);
  const dates = `${compactUtc(start)}/${compactUtc(end)}`;
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", event.title);
  google.searchParams.set("dates", dates);
  if (event.description) google.searchParams.set("details", event.description);
  if (event.location) google.searchParams.set("location", event.location);

  const outlook = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
  outlook.searchParams.set("path", "/calendar/action/compose");
  outlook.searchParams.set("rru", "addevent");
  outlook.searchParams.set("subject", event.title);
  outlook.searchParams.set("startdt", start.toISOString());
  outlook.searchParams.set("enddt", end.toISOString());
  if (event.description) outlook.searchParams.set("body", event.description);
  if (event.location) outlook.searchParams.set("location", event.location);

  return { google: google.toString(), outlook: outlook.toString() };
}

export function buildIcsEvent(event: PortableCalendarEvent, now = new Date()) {
  const { start, end } = eventDates(event);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Torres & Co. Technology LLC//Torres OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.id)}@torrescotechnology.com`,
    `DTSTAMP:${compactUtc(now)}`,
    `DTSTART:${compactUtc(start)}`,
    `DTEND:${compactUtc(end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return { content: lines.join("\r\n"), filename: fileName(event.title) };
}
