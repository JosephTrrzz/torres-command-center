import { describe, expect, it } from "vitest";
import { buildCalendarLinks, buildIcsEvent } from "../lib/calendar-event";

const appointment = {
  id: "job-123",
  title: "Quarterly service review",
  startsAt: "2026-09-08T17:00:00.000Z",
  endsAt: "2026-09-08T18:30:00.000Z",
  description: "Review progress, next steps, and support priorities.",
  location: "5821 SE Johnson Creek Blvd, Portland, OR",
};

describe("individual calendar events", () => {
  it("builds provider links for only the selected appointment", () => {
    const links = buildCalendarLinks(appointment);
    expect(links.google).toContain("calendar.google.com/calendar/render");
    expect(links.google).toContain("20260908T170000Z%2F20260908T183000Z");
    expect(links.outlook).toContain("outlook.office.com/calendar/0/deeplink/compose");
    expect(links.outlook).toContain("Quarterly+service+review");
  });

  it("creates a portable one-event iCalendar file", () => {
    const file = buildIcsEvent(appointment, new Date("2026-09-01T12:00:00.000Z"));
    expect(file.filename).toBe("quarterly-service-review.ics");
    expect(file.content).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0");
    expect(file.content.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(file.content).toContain("DTSTART:20260908T170000Z");
    expect(file.content).toContain("DTEND:20260908T183000Z");
    expect(file.content).toContain("LOCATION:5821 SE Johnson Creek Blvd\\, Portland\\, OR");
  });

  it("defaults appointments without an end time to one hour", () => {
    const file = buildIcsEvent({ ...appointment, endsAt: null });
    expect(file.content).toContain("DTEND:20260908T180000Z");
  });

  it("escapes calendar control characters instead of creating extra fields", () => {
    const file = buildIcsEvent({ ...appointment, description: "First line\nSecond, line; continued" });
    expect(file.content).toContain("DESCRIPTION:First line\\nSecond\\, line\\; continued");
    expect(file.content.match(/DESCRIPTION:/g)).toHaveLength(1);
  });
});
