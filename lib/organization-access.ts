export const ORGANIZATION_ROLES = ["owner", "admin", "operator", "member", "viewer", "client"] as const;

export type OrganizationRole = typeof ORGANIZATION_ROLES[number];

export type OrganizationPermission =
  | "organization.manage"
  | "clients.read"
  | "clients.manage"
  | "integrations.read"
  | "integrations.manage"
  | "reports.read"
  | "reports.export"
  | "audit.read"
  | "automation.manage"
  | "ai.use";

export const ROLE_PERMISSIONS: Record<OrganizationRole, readonly OrganizationPermission[]> = {
  owner: ["organization.manage", "clients.read", "clients.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "audit.read", "automation.manage", "ai.use"],
  admin: ["organization.manage", "clients.read", "clients.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "audit.read", "automation.manage", "ai.use"],
  operator: ["clients.read", "clients.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "ai.use"],
  member: ["clients.read", "integrations.read", "reports.read", "reports.export", "ai.use"],
  viewer: ["clients.read", "integrations.read", "reports.read"],
  client: ["integrations.read", "reports.read", "reports.export", "ai.use"],
};

export function canOrganizationRole(role: OrganizationRole, permission: OrganizationPermission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function legacyRoleToOrganizationRole(role: "owner" | "employee" | "customer"): OrganizationRole {
  if (role === "owner") return "owner";
  if (role === "employee") return "operator";
  return "client";
}
