"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  MCP_SCOPE_GROUPS,
  MCP_SCOPE_LABELS,
  allMcpScopes,
  hasHighRiskMcpScope,
  readMcpScopes,
  toggleMcpScope,
  type McpScope,
} from "@/lib/mcp/scopes";
import type { TokenFlash } from "@/lib/mcpTokenFlash";
import {
  acknowledgeMcpTokenFlash,
  approveMcpPreview,
  mintMcpToken,
  rejectMcpPreview,
  rotateMcpToken,
  revokeMcpToken,
  setHelpersSkipXosApproval,
} from "./actions";

export function MintForm() {
  const [state, action, pending] = useActionState(mintMcpToken, null as TokenFlash);
  const [selected, setSelected] = useState<McpScope[]>([]);
  const secret = state && !("error" in state) ? state : null;
  return (
    <form action={action} className="card relative space-y-4 p-5">
      {secret ? <TokenSecretPanel token={secret.token} name={secret.name} kind="created" /> : null}
      <h2 className="card-title">New agent token</h2>
      {state && "error" in state ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <label className="block text-sm">
        Name
        <input name="name" required maxLength={80} className="input mt-1 w-full" placeholder="Grok Bot" />
      </label>
      <label className="block text-sm">
        Expires in days (blank = no expiry)
        <input name="expires_days" type="number" min={1} max={3650} className="input mt-1 w-40" />
      </label>
      <label className="block text-sm">
        Note
        <input name="note" maxLength={200} className="input mt-1 w-full" />
      </label>
      <ScopePicker selected={selected} setSelected={setSelected} />
      <button type="submit" className="btn-primary" disabled={pending || Boolean(secret)}>
        {pending ? "Creating…" : "Create token"}
      </button>
    </form>
  );
}

export function RotateForm({ tokens }: { tokens: { id: string; name: string; token_prefix: string }[] }) {
  const [state, action, pending] = useActionState(rotateMcpToken, null as TokenFlash);
  if (!tokens.length) return null;
  const secret = state && !("error" in state) ? state : null;
  return (
    <form action={action} className="card relative space-y-3 p-5">
      {secret ? <TokenSecretPanel token={secret.token} name={secret.name} kind="rotated" /> : null}
      <h2 className="card-title">Rotate</h2>
      {state && "error" in state ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <p className="text-sm text-zinc-500">The new token works immediately. The old one keeps working until the overlap ends, then it stops. Use 0 hours to cut it off now.</p>
      <select name="token_id" className="input w-full" required>
        {tokens.map((token) => (
          <option key={token.id} value={token.id}>{token.name} ({token.token_prefix}…)</option>
        ))}
      </select>
      <label className="block text-sm">
        Overlap hours
        <input name="overlap_hours" type="number" min={0} max={336} defaultValue={24} className="input mt-1 w-32" />
      </label>
      <button type="submit" className="btn-primary" disabled={pending || Boolean(secret)}>
        {pending ? "Rotating…" : "Rotate"}
      </button>
    </form>
  );
}

export function ApprovalCard({ id, tool, receipt }: { id: string; tool: string; receipt: string }) {
  return (
    <article className="card space-y-3 p-5">
      <h2 className="card-title">{tool}</h2>
      <p className="text-sm text-zinc-600">
        Approving runs this exact receipt. The agent cannot approve it. A chat draft card is still required in the host before the agent should even ask.
      </p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs">{receipt}</pre>
      <div className="flex gap-2">
        <form action={approveMcpPreview}>
          <input type="hidden" name="confirmation_id" value={id} />
          <button type="submit" className="btn-primary">Approve and run</button>
        </form>
        <form action={rejectMcpPreview}>
          <input type="hidden" name="confirmation_id" value={id} />
          <button type="submit" className="btn-ghost">Reject</button>
        </form>
      </div>
    </article>
  );
}

export function RevokeButton({ id }: { id: string }) {
  return (
    <form action={revokeMcpToken}>
      <input type="hidden" name="token_id" value={id} />
      <button type="submit" className="btn-ghost px-2 py-1 text-xs">Revoke</button>
    </form>
  );
}

/** Master-admin toggle. Off = helpers_run still needs an Agent Access receipt. */
export function HelpersSkipToggle({ id, enabled }: { id: string; enabled: boolean }) {
  return (
    <form action={setHelpersSkipXosApproval} className="max-w-[14rem] space-y-1">
      <input type="hidden" name="token_id" value={id} />
      <input type="hidden" name="helpers_skip_xos_approval" value={enabled ? "false" : "true"} />
      <button
        type="submit"
        className={
          enabled
            ? "rounded border border-amber-400 bg-amber-50 px-2 py-1 text-left text-xs font-medium text-amber-950"
            : "btn-ghost px-2 py-1 text-left text-xs"
        }
        title="When on, helpers_run executes immediately without an Agent Access receipt. Other email/SMS tools still need approval."
      >
        {enabled ? "Helpers: no XOS approval (on)" : "Helpers: require XOS approval"}
      </button>
      {enabled ? (
        <p className="text-[11px] leading-snug text-amber-900">
          Run helpers without XOS approval. Chat approval is still expected before the agent calls the tool.
        </p>
      ) : null}
    </form>
  );
}

function ScopePicker({
  selected,
  setSelected,
}: {
  selected: McpScope[];
  setSelected: (next: McpScope[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Scopes</legend>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(allMcpScopes())}>
          Select all
        </button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(readMcpScopes())}>
          Select all read
        </button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected([])}>
          Clear
        </button>
      </div>
      <div className="space-y-3">
        {MCP_SCOPE_GROUPS.map((group) => (
          <div key={group.title} className="rounded-md border border-zinc-200 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{group.title}</div>
            {group.view || group.edit ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {group.view ? (
                  <ScopeCheck scope={group.view} selected={selected} setSelected={setSelected} hint="View" />
                ) : null}
                {group.edit ? (
                  <ScopeCheck scope={group.edit} selected={selected} setSelected={setSelected} hint="Edit" />
                ) : null}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(group.scopes ?? []).map((scope) => (
                  <ScopeCheck key={scope} scope={scope} selected={selected} setSelected={setSelected} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {hasHighRiskMcpScope(selected) ? (
        <p className="mt-2 text-xs text-amber-800">
          High-risk scopes are checked (delete, payments, payroll, or communications). Those still need a person to approve each send or change in Agent Access, except helpers_run when that token later has “Run helpers without XOS approval” turned on.
        </p>
      ) : null}
    </fieldset>
  );
}

function ScopeCheck({
  scope,
  selected,
  setSelected,
  hint,
}: {
  scope: McpScope;
  selected: McpScope[];
  setSelected: (next: McpScope[]) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="scope"
        value={scope}
        checked={selected.includes(scope)}
        onChange={(event) => setSelected(toggleMcpScope(selected, scope, event.target.checked))}
      />
      <span>
        {MCP_SCOPE_LABELS[scope]}
        {hint ? <span className="ml-1 text-xs text-zinc-400">({hint})</span> : null}
      </span>
    </label>
  );
}

/** One-time secret card. Shown only from useActionState after mint/rotate.
    Done refreshes the page; the secret is never stored for a later reload. */
function TokenSecretPanel({ token, name, kind }: { token: string; name: string; kind: "created" | "rotated" }) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [token]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      field.current?.select();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mcp-token-secret-title"
      className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 shadow-sm"
    >
      <h3 id="mcp-token-secret-title" className="text-base font-semibold">
        {kind === "rotated" ? "New token for" : "Token created for"} {name}
      </h3>
      <p className="mt-1 text-sm font-medium text-amber-900">
        This is the only time you will see this key. Copy it now. After you leave this screen it cannot be shown again.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={field}
          readOnly
          value={token}
          aria-label="One-time agent token"
          className="input w-full flex-1 font-mono text-xs"
        />
        <button type="button" className="btn-primary shrink-0" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        type="button"
        className="btn-ghost mt-3 px-3 py-1.5 text-sm"
        disabled={pending}
        onClick={() => start(async () => { await acknowledgeMcpTokenFlash(); })}
      >
        {pending ? "Refreshing…" : "Done, I've copied it"}
      </button>
    </div>
  );
}
