import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const foundation = readFileSync(
  join(process.cwd(), "app", "design-foundation.css"),
  "utf8",
);
const privateOffice = readFileSync(
  join(process.cwd(), "app", "private-office-production.css"),
  "utf8",
);

describe("layout containment", () => {
  it("keeps shell overlays above page controls and inside the viewport", () => {
    expect(foundation).toContain(".topbar{position:relative;z-index:200}");
    expect(foundation).toContain(".notification-popover{z-index:320");
    expect(foundation).toContain(".notification-list{max-height:");
    expect(foundation).toContain("overflow-y:auto");
  });

  it("collapses dense workspaces before the sidebar crowds their content", () => {
    expect(foundation).toContain("@media(max-width:1180px)");
    expect(foundation).toContain(".crm-summary{grid-template-columns:repeat(2,minmax(0,1fr))}");
    expect(foundation).toContain(".crm-layout{grid-template-columns:1fr}");
  });

  it("keeps the mobile drawer sharp above its blurred backdrop", () => {
    expect(foundation).toContain(".shell-overlay{position:fixed;z-index:35");
    expect(foundation).toContain(".sidebar.open{z-index:40");
    expect(privateOffice).toContain('.app-shell[data-shell-variant=client]>.sidebar.open{z-index:40;background:#091422;opacity:1;filter:none');
  });
});
