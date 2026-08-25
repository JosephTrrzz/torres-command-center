import type { AppRole } from "./types";

export interface NavigationItem {
  href: string;
  label: string;
}

export const APP_NAVIGATION: Record<AppRole, NavigationItem[]> = {
  owner: [
    { href: "/", label: "Overview" },
    { href: "/clients/", label: "Clients" },
    { href: "/portal/", label: "Portal" },
    { href: "/integrations/", label: "Integrations" },
    { href: "/reports/", label: "Reports" },
    { href: "/settings/", label: "Settings" },
  ],
  employee: [
    { href: "/", label: "Overview" },
    { href: "/clients/", label: "Clients" },
    { href: "/integrations/", label: "Integrations" },
    { href: "/reports/", label: "Reports" },
  ],
  customer: [{ href: "/portal/", label: "My account" }],
};

export function roleLabel(role: AppRole) {
  return role === "owner" ? "Owner" : role === "employee" ? "Team member" : "Customer";
}

export function defaultRouteForRole(role: AppRole) {
  return role === "customer" ? "/portal/" : "/";
}

export function isSafeReturnTo(path: string | null) {
  return Boolean(path?.startsWith("/") && !path.startsWith("//"));
}

function matchesRoute(pathname: string, route: string) {
  const root = route.endsWith("/") ? route.slice(0, -1) : route;
  return (
    pathname === root ||
    pathname === `${root}/` ||
    pathname.startsWith(`${root}/`)
  );
}

export function canAccessPath(role: AppRole, pathname: string) {
  if (matchesRoute(pathname, "/login")) return true;
  if (role === "owner") return true;
  if (role === "customer") return matchesRoute(pathname, "/portal");

  const employeeRoots = ["/clients", "/integrations", "/reports", "/portal"];
  return pathname === "/" || employeeRoots.some((root) => matchesRoute(pathname, root));
}
