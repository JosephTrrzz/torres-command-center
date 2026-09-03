"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "../../components/shell";
import { LoadingRegion, RefreshIndicator } from "../../components/loading-system";
import { PageHeader } from "../../components/ui-foundation";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import { labelOperationsValue } from "../../lib/operations";
import { fetchSchedule, type ScheduleClient } from "../../lib/schedule-api";
import { SCHEDULE_CATEGORIES, calendarDays, dateKey, eventsForDay, filterScheduleEvents, isScheduleView, moveScheduleDate, parseScheduleDate, scheduleHeading, type ScheduleCategory, type ScheduleEvent, type ScheduleView } from "../../lib/schedule";
import { readStoredSession } from "../../lib/supabase-auth";
import type { AuthSession } from "../../lib/types";

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function dateLabel(value: Date, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", options).format(value);
}

function categoryLabel(category: ScheduleCategory) {
  return category === "job" ? "Service work" : category === "appointment" ? "Appointments" : "Tasks";
}

export default function SchedulePage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<ScheduleClient[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ScheduleEvent | null>(null);
  const [view, setView] = useState<ScheduleView>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("");
  const [categories, setCategories] = useState<ScheduleCategory[]>(SCHEDULE_CATEGORIES);
  const [timezone, setTimezone] = useState("Local time");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const updateUrl = (next: { view?: ScheduleView; anchor?: Date; query?: string; clientId?: string; categories?: ScheduleCategory[] }) => {
    const url = new URL(window.location.href);
    const nextView = next.view ?? view;
    const nextAnchor = next.anchor ?? anchor;
    const nextQuery = next.query ?? query;
    const nextClient = next.clientId ?? clientId;
    const nextCategories = next.categories ?? categories;
    url.searchParams.set("view", nextView);
    url.searchParams.set("date", dateKey(nextAnchor));
    nextQuery ? url.searchParams.set("q", nextQuery) : url.searchParams.delete("q");
    nextClient ? url.searchParams.set("client", nextClient) : url.searchParams.delete("client");
    nextCategories.length === SCHEDULE_CATEGORIES.length ? url.searchParams.delete("categories") : url.searchParams.set("categories", nextCategories.join(","));
    window.history.replaceState({}, "", url);
  };

  const load = async (activeSession: AuthSession, background = false) => {
    background ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const result = await fetchSchedule(activeSession);
      setClients(result.clients);
      setEvents(result.events);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The agency schedule could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) return;
    setSession(stored);
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time");
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const requestedCategories = (params.get("categories") || "").split(",").filter((value): value is ScheduleCategory => SCHEDULE_CATEGORIES.includes(value as ScheduleCategory));
    setView(isScheduleView(requestedView) ? requestedView : window.matchMedia("(max-width: 680px)").matches ? "agenda" : "month");
    setAnchor(parseScheduleDate(params.get("date")));
    setQuery(params.get("q") || "");
    setClientId(params.get("client") || "");
    if (requestedCategories.length) setCategories(requestedCategories);
    const role = appRoleForOrganizationRole(stored.organization?.role, stored.profile.role);
    if (role === "customer") {
      setError("Your client schedule is available in Services.");
      setLoading(false);
      return;
    }
    void load(stored);
  }, []);

  useEffect(() => {
    if (!selected) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && closeEventDetails();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  const filteredEvents = useMemo(() => filterScheduleEvents(events, { query, clientId, categories }), [events, query, clientId, categories]);
  const days = useMemo(() => calendarDays(anchor, view), [anchor, view]);
  const todayKey = dateKey(new Date());
  const selectedClient = clients.find((client) => client.id === clientId);
  const upcomingCount = filteredEvents.filter((event) => new Date(event.starts_at) >= new Date() && event.status !== "canceled").length;

  const chooseView = (nextView: ScheduleView) => { setView(nextView); updateUrl({ view: nextView }); };
  const move = (direction: -1 | 1) => { const next = moveScheduleDate(anchor, view, direction); setAnchor(next); updateUrl({ anchor: next }); };
  const goToday = () => { const next = new Date(); setAnchor(next); updateUrl({ anchor: next }); };
  const toggleCategory = (category: ScheduleCategory) => {
    const next = categories.includes(category) ? categories.filter((item) => item !== category) : [...categories, category];
    if (!next.length) return;
    setCategories(next);
    updateUrl({ categories: next });
  };
  const openEventDetails = (event: ScheduleEvent) => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(event);
  };
  const closeEventDetails = () => {
    setSelected(null);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  };

  return <Shell active="Schedule">
    <PageHeader eyebrow="Agency calendar" title="Schedule" description="See every client commitment in one place, then open the individual Operations workspace to schedule or change delivery." actions={<div className="schedule-heading-actions"><RefreshIndicator active={refreshing} label="Refreshing schedule"/><button className="button button-light" type="button" disabled={!session || refreshing} onClick={() => session && void load(session, true)}>Refresh</button>{selectedClient ? <Link className="button button-dark" href={`/operations/?client=${encodeURIComponent(selectedClient.id)}`}>Schedule client work</Link> : <span className="schedule-action-hint">Choose a client to schedule work</span>}</div>} />
    {error && <p className="integration-notice schedule-notice" role="status">{error}</p>}
    {loading ? <LoadingRegion active label="Loading agency schedule" variant="calendar" /> : <>
      <section className="schedule-summary" aria-label="Schedule summary">
        <article><span>Visible events</span><strong>{filteredEvents.length}</strong><small>Current filters</small></article>
        <article><span>Upcoming</span><strong>{upcomingCount}</strong><small>Open commitments</small></article>
        <article><span>Clients</span><strong>{new Set(filteredEvents.map((event) => event.client_id)).size}</strong><small>Represented in view</small></article>
        <article><span>Time zone</span><strong>{timezone.replace(/_/g, " ")}</strong><small>Times shown locally</small></article>
      </section>
      <section className="schedule-workspace">
        <header className="schedule-toolbar">
          <div className="schedule-navigation"><button type="button" onClick={goToday}>Today</button><button type="button" aria-label="Previous period" onClick={() => move(-1)}><span aria-hidden="true">‹</span></button><button type="button" aria-label="Next period" onClick={() => move(1)}><span aria-hidden="true">›</span></button><h2>{scheduleHeading(anchor, view)}</h2></div>
          <div className="schedule-view-switch" aria-label="Calendar view">{(["month", "week", "agenda"] as ScheduleView[]).map((item) => <button type="button" aria-pressed={view === item} className={view === item ? "active" : ""} onClick={() => chooseView(item)} key={item}>{labelOperationsValue(item)}</button>)}</div>
        </header>
        <div className="schedule-filters">
          <label className="schedule-search"><span className="sr-only">Search schedule</span><input type="search" value={query} placeholder="Search events, clients, or owners" onChange={(event) => { setQuery(event.target.value); updateUrl({ query: event.target.value }); }} /></label>
          <label><span>Client</span><select value={clientId} onChange={(event) => { setClientId(event.target.value); updateUrl({ clientId: event.target.value }); }}><option value="">All clients</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label>
          <details className="schedule-category-filter"><summary>Categories <b>{categories.length}</b></summary><div>{SCHEDULE_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={categories.includes(category)} onChange={() => toggleCategory(category)} />{categoryLabel(category)}</label>)}</div></details>
          <span className="schedule-timezone">{timezone.replace(/_/g, " ")}</span>
        </div>
        {view === "month" ? <MonthView anchor={anchor} days={days} events={filteredEvents} todayKey={todayKey} onSelect={openEventDetails} /> : view === "week" ? <WeekView days={days} events={filteredEvents} todayKey={todayKey} onSelect={openEventDetails} /> : <AgendaView days={days} events={filteredEvents} onSelect={openEventDetails} />}
      </section>
    </>}
    {selected && <><button type="button" className="schedule-drawer-scrim" aria-label="Close event details" onClick={closeEventDetails} /><aside className="schedule-drawer" role="dialog" aria-modal="true" aria-labelledby="schedule-event-title">
      <button className="schedule-drawer-close" ref={closeButtonRef} type="button" aria-label="Close event details" onClick={closeEventDetails}>×</button>
      <p className="eyebrow">{categoryLabel(selected.kind)}</p><h2 id="schedule-event-title">{selected.title}</h2><p className="schedule-event-client">{selected.client_name}</p>
      <dl><div><dt>Starts</dt><dd>{dateLabel(new Date(selected.starts_at), { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</dd></div>{selected.ends_at && <div><dt>Ends</dt><dd>{dateLabel(new Date(selected.ends_at), { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</dd></div>}<div><dt>Status</dt><dd>{labelOperationsValue(selected.status)}</dd></div><div><dt>Assigned to</dt><dd>{selected.assignee_name || "Unassigned"}</dd></div><div><dt>Visibility</dt><dd>{selected.kind === "job" ? "Follows the job’s client visibility setting" : "Internal team calendar"}</dd></div></dl>
      <div className="schedule-drawer-actions"><Link className="button button-dark" href={`/operations/?client=${encodeURIComponent(selected.client_id)}${selected.job_id ? `&job=${encodeURIComponent(selected.job_id)}` : ""}`}>Open client Operations</Link></div>
    </aside></>}
  </Shell>;
}

function EventButton({ event, compact = false, onSelect }: { event: ScheduleEvent; compact?: boolean; onSelect: (event: ScheduleEvent) => void }) {
  return <button type="button" className={`schedule-event schedule-event-${event.kind} ${compact ? "compact" : ""}`} onClick={() => onSelect(event)}><span>{timeLabel(event.starts_at)}</span><strong>{event.title}</strong>{!compact && <small>{event.client_name} · {event.assignee_name || "Unassigned"}</small>}</button>;
}

function MonthView({ anchor, days, events, todayKey, onSelect }: { anchor: Date; days: Date[]; events: ScheduleEvent[]; todayKey: string; onSelect: (event: ScheduleEvent) => void }) {
  return <div className="schedule-month" role="grid" aria-label={scheduleHeading(anchor, "month")}><div className="schedule-weekdays" role="row">{dayNames.map((day) => <span role="columnheader" key={day}>{day}</span>)}</div><div className="schedule-month-grid">{days.map((day) => { const dayEvents = eventsForDay(events, day); const outside = day.getMonth() !== anchor.getMonth(); return <section role="gridcell" className={`${outside ? "outside" : ""} ${dateKey(day) === todayKey ? "today" : ""}`} aria-label={dateLabel(day)} key={dateKey(day)}><header><time dateTime={dateKey(day)}>{day.getDate()}</time>{dayEvents.length > 3 && <span>{dayEvents.length}</span>}</header>{dayEvents.slice(0, 3).map((event) => <EventButton compact event={event} onSelect={onSelect} key={`${event.client_id}-${event.kind}-${event.id}`} />)}{dayEvents.length > 3 && <button type="button" className="schedule-more" onClick={() => onSelect(dayEvents[3])}>+{dayEvents.length - 3} more</button>}</section>; })}</div></div>;
}

function WeekView({ days, events, todayKey, onSelect }: { days: Date[]; events: ScheduleEvent[]; todayKey: string; onSelect: (event: ScheduleEvent) => void }) {
  return <div className="schedule-week" aria-label="Week schedule">{days.map((day) => { const dayEvents = eventsForDay(events, day); const isToday = dateKey(day) === todayKey; return <section className={isToday ? "today" : ""} key={dateKey(day)}><header><span>{dayNames[day.getDay()]}</span><strong>{day.getDate()}</strong>{isToday && <small>Today</small>}</header>{isToday && <div className="schedule-now"><span />Current time</div>}<div>{dayEvents.length ? dayEvents.map((event) => <EventButton event={event} onSelect={onSelect} key={`${event.client_id}-${event.kind}-${event.id}`} />) : <p>No events</p>}</div></section>; })}</div>;
}

function AgendaView({ days, events, onSelect }: { days: Date[]; events: ScheduleEvent[]; onSelect: (event: ScheduleEvent) => void }) {
  const populated = days.map((day) => ({ day, events: eventsForDay(events, day) })).filter((group) => group.events.length);
  return populated.length ? <div className="schedule-agenda-view">{populated.map((group) => <section key={dateKey(group.day)}><header><time dateTime={dateKey(group.day)}>{dateLabel(group.day)}</time><span>{group.events.length} {group.events.length === 1 ? "event" : "events"}</span></header><div>{group.events.map((event) => <EventButton event={event} onSelect={onSelect} key={`${event.client_id}-${event.kind}-${event.id}`} />)}</div></section>)}</div> : <div className="schedule-empty"><p className="eyebrow">Calendar clear</p><h2>No events match this view.</h2><p>Adjust the client, category, search, or date range to see another part of the schedule.</p></div>;
}
