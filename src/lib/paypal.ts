import { Client, Environment, OrdersController, CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";

/* ============ PayPal (Orders v2) ============
   Clients pay a retainer/balance from the public /pay/[token] page. We create
   an order, the client approves it with the on-page PayPal buttons, then we
   capture server-side — recording the payment only when the capture is
   COMPLETED. Set in .env.local (and Netlify env):
     PAYPAL_ENV            = sandbox | live
     PAYPAL_CLIENT_ID      / PAYPAL_CLIENT_SECRET  (server, secret)
     NEXT_PUBLIC_PAYPAL_CLIENT_ID  (same id, exposed for the on-page buttons)
     PAYPAL_WEBHOOK_ID     (optional, enables webhook signature verification) */

export function isPaypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export function paypalLive(): boolean {
  return (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase() === "live";
}

function apiBase(): string {
  return paypalLive() ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function client(): Client | null {
  const oAuthClientId = process.env.PAYPAL_CLIENT_ID;
  const oAuthClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!oAuthClientId || !oAuthClientSecret) return null;
  return new Client({
    clientCredentialsAuthCredentials: { oAuthClientId, oAuthClientSecret },
    environment: paypalLive() ? Environment.Production : Environment.Sandbox,
  });
}

/** Create an order for `amount` USD. Returns the PayPal order id for the buttons. */
export async function createPaypalOrder(
  amount: number,
  opts: { customId?: string; description?: string } = {}
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const c = client();
  if (!c) return { ok: false, error: "PayPal not configured" };
  try {
    const orders = new OrdersController(c);
    const { result } = await orders.createOrder({
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: { currencyCode: "USD", value: amount.toFixed(2) },
            // customId flows through to the capture resource — lets the webhook
            // map a capture back to the XOS event
            ...(opts.customId ? { customId: opts.customId.slice(0, 127) } : {}),
            ...(opts.description ? { description: opts.description.slice(0, 127) } : {}),
          },
        ],
      },
      prefer: "return=minimal",
    });
    if (!result.id) return { ok: false, error: "PayPal returned no order id" };
    return { ok: true, id: result.id };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

export type CaptureResult = {
  completed: boolean;
  captureId: string | null;
  amount: number | null;
  payerEmail: string | null;
  payerName: string | null;
};

/** Capture an approved order. Money only moves here; record on `completed`. */
export async function capturePaypalOrder(
  orderId: string
): Promise<{ ok: true; capture: CaptureResult } | { ok: false; error: string }> {
  const c = client();
  if (!c) return { ok: false, error: "PayPal not configured" };
  try {
    const orders = new OrdersController(c);
    const { result } = await orders.captureOrder({ id: orderId, prefer: "return=representation" });
    const cap = result.purchaseUnits?.[0]?.payments?.captures?.[0];
    const name = result.payer?.name;
    return {
      ok: true,
      capture: {
        completed: result.status === "COMPLETED" && cap?.status === "COMPLETED",
        captureId: cap?.id ?? null,
        amount: cap?.amount?.value ? Number(cap.amount.value) : null,
        payerEmail: result.payer?.emailAddress ?? null,
        payerName: name ? `${name.givenName ?? ""} ${name.surname ?? ""}`.trim() || null : null,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/* ============ Vault + autopay (raw REST) ============
   The typed SDK doesn't surface vault attributes / merchant-initiated charges
   cleanly, so the autopay path uses raw REST against the same OAuth token. */

type RestOrder = {
  status?: string;
  id?: string;
  message?: string;
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  payment_source?: { paypal?: { attributes?: { vault?: { id?: string; customer?: { id?: string } } } } };
  purchase_units?: { payments?: { captures?: { id?: string; status?: string; amount?: { value?: string } }[] } }[];
};

export type VaultCaptureResult = CaptureResult & { vaultId: string | null; customerId: string | null };

function restAmount(amount: number, opts: { customId?: string; description?: string }) {
  return {
    currency_code: "USD",
    value: amount.toFixed(2),
    ...(opts.customId ? { custom_id: opts.customId.slice(0, 127) } : {}),
    ...(opts.description ? { description: opts.description.slice(0, 127) } : {}),
  };
}

/** Create an order that ALSO vaults the buyer's PayPal method on success
    (store_in_vault). Returns the order id for the on-page buttons. */
export async function createVaultOrderRest(
  amount: number,
  opts: { customId?: string; description?: string } = {}
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "PayPal not configured" };
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { currency_code: "USD", value: amount.toFixed(2) },
        ...(opts.customId ? { custom_id: opts.customId.slice(0, 127) } : {}),
        ...(opts.description ? { description: opts.description.slice(0, 127) } : {}),
      },
    ],
    payment_source: {
      paypal: {
        attributes: {
          vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" },
        },
        experience_context: {
          brand_name: "Xpress Entertainment",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      },
    },
  };
  try {
    const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as RestOrder;
    if (!res.ok || !data.id) return { ok: false, error: data.message ?? `HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

function readCapture(data: RestOrder): VaultCaptureResult {
  const cap = data.purchase_units?.[0]?.payments?.captures?.[0];
  const vault = data.payment_source?.paypal?.attributes?.vault;
  const name = data.payer?.name;
  return {
    completed: data.status === "COMPLETED" && cap?.status === "COMPLETED",
    captureId: cap?.id ?? null,
    amount: cap?.amount?.value ? Number(cap.amount.value) : null,
    payerEmail: data.payer?.email_address ?? null,
    payerName: name ? `${name.given_name ?? ""} ${name.surname ?? ""}`.trim() || null : null,
    vaultId: vault?.id ?? null,
    customerId: vault?.customer?.id ?? null,
  };
}

/** Capture an approved order via REST, also returning the vault id when the
    order requested vaulting. */
export async function captureVaultOrderRest(
  orderId: string
): Promise<{ ok: true; capture: VaultCaptureResult } | { ok: false; error: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "PayPal not configured" };
  try {
    const res = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const data = (await res.json()) as RestOrder;
    if (!res.ok) return { ok: false, error: data.message ?? `HTTP ${res.status}` };
    return { ok: true, capture: readCapture(data) };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/** Merchant-initiated charge against a saved (vaulted) payment method — no buyer
    interaction. Used by the autopay cron. Idempotent via PayPal-Request-Id. */
export async function chargeVaultedPayment(
  amount: number,
  vaultId: string,
  opts: { customId?: string; description?: string; idempotencyKey?: string } = {}
): Promise<{ ok: true; capture: CaptureResult } | { ok: false; error: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "PayPal not configured" };
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (opts.idempotencyKey) headers["PayPal-Request-Id"] = opts.idempotencyKey.slice(0, 100);
  const body = {
    intent: "CAPTURE",
    purchase_units: [{ amount: restAmount(amount, opts) }],
    payment_source: {
      paypal: {
        vault_id: vaultId,
        stored_credential: { payment_initiator: "MERCHANT", payment_type: "RECURRING", usage: "SUBSEQUENT" },
      },
    },
  };
  try {
    const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    let data = (await res.json()) as RestOrder;
    if (!res.ok) return { ok: false, error: data.message ?? `HTTP ${res.status}` };
    // a vault_id order may need an explicit capture if it didn't auto-complete
    if (data.status !== "COMPLETED" && data.id) {
      const capRes = await fetch(`${apiBase()}/v2/checkout/orders/${data.id}/capture`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      data = (await capRes.json()) as RestOrder;
      if (!capRes.ok) return { ok: false, error: data.message ?? `HTTP ${capRes.status}` };
    }
    return { ok: true, capture: readCapture(data) };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

/** OAuth token for raw REST calls (webhook verification + vault/autopay). */
async function accessToken(): Promise<string | null> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

/** Verify a webhook came from PayPal. Returns true only when PAYPAL_WEBHOOK_ID
    is set AND PayPal confirms the signature — so an unconfigured/forged hook is
    never trusted. (The capture endpoint is the primary record path; the webhook
    is an idempotent backup.) */
export async function verifyPaypalWebhook(
  headers: Headers,
  rawBody: string
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const token = await accessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { verification_status?: string };
    return data.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}
