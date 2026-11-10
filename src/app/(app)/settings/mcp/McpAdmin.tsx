"use client";

import { useActionState, useState, useTransition } from "react";
import {
  MCP_SCOPES,
  allMcpScopes,
  hasHighRiskMcpScope,
  readMcpScopes,
  toggleMcpScope,
  type McpScope,
} from "@/lib/mcp/scopes";
import {
  acknowledgeMcpTokenFlash,
  approveMcpPreview,
  mintMcpToken,
  rejectMcpPreview,
  rotateMcpToken,
  revokeMcpToken,
  type TokenFlash,
} from "./actions";

export function MintForm() {
  const [state, action, pending] = useActionState(mintMcpToken, null as TokenFlash);
  const [selected, setSelected] = useState<McpScope[]>([]);
  return (
    <form action={action} className="card space-y-4 p-5">
      <h2 className="card-title">New agent token</h2>
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
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Scopes</legend>
        <div className="mb-2 flex flex-wrap gap-2">
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
        <div className="grid gap-1 sm:grid-cols-2">
          {MCP_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="scope"
                value={scope}
                checked={selected.includes(scope)}
                onChange={(event) => setSelected(toggleMcpScope(selected, scope, event.target.checked))}
              />
              {scope}
            </label>
          ))}
        </div>
        {hasHighRiskMcpScope(selected) ? (
          <p className="mt-2 text-xs text-amber-800">
            High-risk scopes are checked (delete, money, payroll, or communications). Those still need a person to approve each send or change.
          </p>
        ) : null}
      </fieldset>
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Creating…" : "Create token"}</button>
      <TokenOnce state={state} />
    </form>
  );
}

export function RotateForm({ tokens }: { tokens: { id: string; name: string; token_prefix: string }[] }) {
  const [state, action, pending] = useActionState(rotateMcpToken, null as TokenFlash);
  if (!tokens.length) return null;
  return (
    <form action={action} className="card space-y-3 p-5">
      <h2 className="card-title">Rotate</h2>
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
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Rotating…" : "Rotate"}</button>
      <TokenOnce state={state} />
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

function TokenOnce({ state }: { state: TokenFlash }) {
  const [pending, start] = useTransition();
  if (!state) return null;
  if ("error" in state) return <p className="text-sm text-red-600">{state.error}</p>;
  return (
    <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">Copy this token now. It is not stored and will not be shown again.</p>
      <input readOnly value={state.token} className="input mt-2 w-full font-mono text-xs" />
      <button
        type="button"
        className="btn-ghost mt-2 px-2 py-1 text-xs"
        disabled={pending}
        onClick={() => start(async () => { await acknowledgeMcpTokenFlash(); })}
      >
        {pending ? "Refreshing…" : "I've copied it — refresh the list"}
      </button>
    </div>
  );
}
