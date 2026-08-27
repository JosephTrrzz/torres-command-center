import type { AppRole, OrganizationRole } from "./types";

export interface NavigationItem {
  href: string;
  label: string;
}

export const APP_NAVIGATION: Record<AppRole, NavigationItem[]> = {
  owner: [
    { href: "/today/", label: "Today" },
    { href: "/", label: "Overview" },
    { href: "/clients/", label: "Clients" },
    { href: "/crm/", label: "CRM" },
    { href: "/projects/", label: "Projects" },
    { href: "/operations/", label: "Operations" },
    { href: "/portal/", label: "Portal" },
    { href: "/integrations/", label: "Integrations" },
    { href: "/reports/", label: "Reports" },
    { href: "/settings/", label: "Settings" },
  ],
  employee: [
    { href: "/today/", label: "Today" },
    { href: "/", label: "Overview" },
    { href: "/clients/", label: "Clients" },
    { href: "/crm/", label: "CRM" },
    { href: "/projects/", label: "Projects" },
    { href: "/operations/", label: "Operations" },
    { href: "/integrations/", label: "Integrations" },
    { href: "/reports/", label: "Reports" },
  ],
  customer: [
    { href: "/today/", label: "Today" },
    { href: "/onboarding/", label: "Onboarding" },
    { href: "/projects/", label: "Projects" },
    { href: "/operations/", label: "Operations" },
    { href: "/portal/", label: "My account" },
  ],
};

export function roleLabel(role: AppRole) {
  return role === "owner" ? "Owner" : role === "employee" ? "Team member" : "Customer";
}

export function appRoleForOrganizationRole(role: OrganizationRole | undefined, legacyRole: AppRole): AppRole {
  if (!role) return legacyRole;
  if (role === "owner" || role === "admin") return "owner";
  if (role === "client") return "customer";
  return "employee";
}

export function organizationRoleLabel(role: OrganizationRole | undefined, legacyRole: AppRole) {
  if (!role) return roleLabel(legacyRole);
  return role === "owner" ? "Owner" : role === "admin" ? "Administrator" : role === "operator" ? "Operator" : role === "member" ? "Team member" : role === "viewer" ? "Viewer" : "Client";
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
  if (role === "customer") return matchesRoute(pathname, "/portal") || matchesRoute(pathname, "/today") || matchesRoute(pathname, "/onboarding") || matchesRoute(pathname, "/projects") || matchesRoute(pathname, "/operations");

  const employeeRoots = ["/today", "/clients", "/crm", "/projects", "/operations", "/integrations", "/reports", "/portal"];
  return pathname === "/" || employeeRoots.some((root) => matchesRoute(pathname, root));
}
