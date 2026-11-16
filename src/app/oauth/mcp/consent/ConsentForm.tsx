"use client";

import { useState } from "react";
import {
  MCP_SCOPE_GROUPS,
  MCP_SCOPE_LABELS,
  hasHighRiskMcpScope,
  isHighRiskMcpScope,
  toggleMcpScope,
  type McpScope,
} from "@/lib/mcp/scopes";
import { approveMcpOAuthConsent, denyMcpOAuthConsent } from "./actions";

export function ConsentForm({
  requestId,
  clientName,
  redirectUri,
  defaultScopes,
  defaultName,
}: {
  requestId: string;
  clientName: string;
  redirectUri: string;
  defaultScopes: McpScope[];
  defaultName: string;
}) {
  const [selected, setSelected] = useState<McpScope[]>(defaultScopes);
  const risky = hasHighRiskMcpScope(selected);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="page-title mb-1">Allow agent access?</h1>
        <p className="text-sm text-zinc-500">
          <span className="font-medium text-zinc-800">{clientName}</span> wants to connect to XOS as an agent.
          You stay signed in as yourself; the agent gets its own named identity with the scopes you pick.
        </p>
      </div>

      <div className="card space-y-2 p-4 text-sm">
        <div>
          <span className="text-zinc-500">Client</span>
          <div className="font-medium">{clientName}</div>
        </div>
        <div>
          <span className="text-zinc-500">Redirect URI</span>
          <div className="break-all font-mono text-xs">{redirectUri}</div>
        </div>
      </div>

      <form action={approveMcpOAuthConsent} className="card space-y-4 p-5">
        <input type="hidden" name="request_id" value={requestId} />
        <label className="block text-sm">
          Connection name
          <input
            name="connection_name"
            required
            maxLength={80}
            defaultValue={defaultName}
            className="input mt-1 w-full"
            placeholder="Grok — Mariah"
          />
        </label>

        <div className="space-y-3">
          <div className="text-sm font-medium">Scopes</div>
          <p className="text-xs text-zinc-500">
            Defaults are read-only. Payments, payroll, delete, and sending email/SMS stay off until you tick them.
          </p>
          {MCP_SCOPE_GROUPS.map((group) => (
            <div key={group.title} className="rounded border border-zinc-200 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{group.title}</div>
              <div className="flex flex-wrap gap-2">
                {group.view ? (
                  <ScopeCheck
                    scope={group.view}
                    selected={selected}
                    setSelected={setSelected}
                  />
                ) : null}
                {group.edit ? (
                  <ScopeCheck
                    scope={group.edit}
                    selected={selected}
                    setSelected={setSelected}
                  />
                ) : null}
                {(group.scopes ?? []).map((scope) => (
                  <ScopeCheck key={scope} scope={scope} selected={selected} setSelected={setSelected} />
                ))}
              </div>
            </div>
          ))}
          {selected.map((scope) => (
            <input key={scope} type="hidden" name="scope" value={scope} />
          ))}
        </div>

        {risky ? (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            You are granting money, delete, and/or communications scopes. Only do this for agents you trust.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={!selected.length}>
            Allow
          </button>
        </div>
      </form>

      <form action={denyMcpOAuthConsent}>
        <input type="hidden" name="request_id" value={requestId} />
        <button type="submit" className="btn-ghost">
          Deny
        </button>
      </form>
    </div>
  );
}

function ScopeCheck({
  scope,
  selected,
  setSelected,
}: {
  scope: McpScope;
  selected: McpScope[];
  setSelected: (next: McpScope[]) => void;
}) {
  const on = selected.includes(scope);
  const risky = isHighRiskMcpScope(scope);
  return (
    <label
      className={
        risky
          ? "flex cursor-pointer items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950"
          : "flex cursor-pointer items-center gap-2 rounded border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700"
      }
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setSelected(toggleMcpScope(selected, scope, e.target.checked))}
        className="size-3.5 accent-brand-light"
      />
      {MCP_SCOPE_LABELS[scope]}
    </label>
  );
}
