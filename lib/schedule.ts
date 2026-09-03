import type { CalendarEntry } from "./operations";

export type ScheduleView = "month" | "week" | "agenda";
export type ScheduleCategory = CalendarEntry["kind"];

export interface ScheduleEvent extends CalendarEntry {
  client_id: string;
  client_name: string;
  assignee_name: string;
}

export const SCHEDULE_CATEGORIES: ScheduleCategory[] = ["job", "appointment", "task"];

export function isScheduleView(value: string | null): value is ScheduleView {
  return value === "month" || value === "week" || value === "agenda";
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function parseScheduleDate(value: string | null, fallback = new Date()) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfDay(fallback);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day ? startOfDay(fallback) : parsed;
}

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
}

export function startOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

export function calendarDays(anchor: Date, view: ScheduleView) {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  if (view === "agenda") return Array.from({ length: 31 }, (_, index) => addDays(anchor, index));
  const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function moveScheduleDate(anchor: Date, view: ScheduleView, direction: -1 | 1) {
  if (view === "week") return addDays(anchor, direction * 7);
  if (view === "agenda") return addDays(anchor, direction * 31);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

export function eventsForDay(events: ScheduleEvent[], day: Date) {
  const key = dateKey(day);
  return events.filter((event) => dateKey(new Date(event.starts_at)) === key);
}

export function filterScheduleEvents(events: ScheduleEvent[], options: { query: string; clientId: string; categories: ScheduleCategory[] }) {
  const query = options.query.trim().toLowerCase();
  const categories = new Set(options.categories);
  return events.filter((event) => {
    if (options.clientId && event.client_id !== options.clientId) return false;
    if (!categories.has(event.kind)) return false;
    if (!query) return true;
    return [event.title, event.client_name, event.assignee_name, event.status, event.kind].some((value) => value.toLowerCase().includes(query));
  }).sort((left, right) => left.starts_at.localeCompare(right.starts_at));
}

export function scheduleHeading(anchor: Date, view: ScheduleView) {
  if (view === "month") return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(anchor);
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const startLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(start);
    const endLabel = new Intl.DateTimeFormat("en-US", { month: start.getMonth() === end.getMonth() ? undefined : "short", day: "numeric", year: "numeric" }).format(end);
    return `${startLabel} – ${endLabel}`;
  }
  const end = addDays(anchor, 30);
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(anchor)} – ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(end)}`;
}
