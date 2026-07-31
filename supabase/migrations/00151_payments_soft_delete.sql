-- Soft-delete for payments (money records must be recoverable, not hard-deleted).
-- removePayment previously ran a hard .delete() with no undo. Now it stamps
-- deleted_at/deleted_by; a "Recently removed" section on the event Financials tab
-- restores it. All balance/log reads filter `deleted_at is null` so a removed
-- payment stops counting immediately (same effect as the old delete), but the row
-- survives for restore.
alter table payments add column if not exists deleted_at timestamptz;
alter table payments add column if not exists deleted_by text;

-- Active-payment lookups (every balance/log query) only ever want live rows.
create index if not exists payments_active_event_idx on payments(event_id) where deleted_at is null;
