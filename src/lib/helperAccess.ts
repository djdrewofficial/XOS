// Who may see/run a booking helper button on an event (migration 00192).
// Empty list = no restriction. Event-type scoping applies to everyone (it keeps
// the wrong contract/email off an event); role scoping never limits master_admin.

export const HELPER_ROLE_OPTIONS = [
  { id: "admin", name: "Admin" },
  { id: "salesperson", name: "Salesperson" },
  { id: "employee", name: "Employee" },
];

/** Stored when a helper is unchecked from every event type (an empty list means "all"). */
export const NO_EVENT_TYPES = "00000000-0000-0000-0000-000000000000";

type HelperScope = {
  visible_event_type_ids?: string[] | null;
  allowed_roles?: string[] | null;
};

export function helperAllowedForEventType(h: HelperScope, eventTypeId: string | null | undefined): boolean {
  const types = h.visible_event_type_ids ?? [];
  return types.length === 0 || (!!eventTypeId && types.includes(eventTypeId));
}

export function helperAllowedForRole(h: HelperScope, role: string | null | undefined): boolean {
  const roles = h.allowed_roles ?? [];
  return roles.length === 0 || role === "master_admin" || (!!role && roles.includes(role));
}

export function helperAllowed(h: HelperScope, eventTypeId: string | null | undefined, role: string | null | undefined): boolean {
  return helperAllowedForEventType(h, eventTypeId) && helperAllowedForRole(h, role);
}
