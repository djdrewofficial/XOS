/* Office vs field-staff tiers (no server imports — safe anywhere). Field staff =
   any employee tier outside OFFICE_ROLES (employee, marketing, or unknown —
   fails closed). Mirrors the database's xos_is_field_staff() (migration 00217). */

export const OFFICE_ROLES: ReadonlySet<string> = new Set(["master_admin", "admin", "salesperson"]);

export function isFieldStaffRole(role: string | null | undefined): boolean {
  return !OFFICE_ROLES.has(role ?? "");
}
