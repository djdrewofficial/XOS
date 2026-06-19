#!/usr/bin/env bash
# Cloudflare hardening for the xpressdjs.com zone (Pro plan).
# Runs against the Cloudflare API — your token stays in YOUR shell, never in the
# repo or chat. Idempotent: safe to re-run.
#
# USAGE:
#   1) Create a SCOPED API token at https://dash.cloudflare.com/profile/api-tokens
#      "Create Token" -> Custom token, with these permissions (Zone scope, only
#      the xpressdjs.com zone):
#        - Zone : Zone Settings : Edit
#        - Zone : Zone WAF      : Edit
#      Set TTL to a day (you'll revoke it after).
#   2) Find your Zone ID: dash -> xpressdjs.com -> Overview -> right rail "Zone ID".
#   3) Run:
#        CF_API_TOKEN=xxxxx CF_ZONE_ID=yyyyy bash scripts/cf-harden.sh
#   4) Delete/revoke the token afterward.

set -u
: "${CF_API_TOKEN:?Set CF_API_TOKEN (scoped Cloudflare token)}"
: "${CF_ZONE_ID:?Set CF_ZONE_ID (xpressdjs.com zone id)}"
API="https://api.cloudflare.com/client/v4"
ok() { grep -q '"success":true' <<<"$1"; }

setting() { # name value  -> PATCH a single zone setting
  local name="$1" value="$2"
  local res
  res=$(curl -s -X PATCH "$API/zones/$CF_ZONE_ID/settings/$name" \
    -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
    --data "{\"value\":$value}")
  if ok "$res"; then echo "  ✓ $name = $value"
  else echo "  ✗ $name -> $(grep -o '"message":"[^"]*"' <<<"$res" | head -1)"; fi
}

echo "== 1. TLS / HTTPS settings =="
setting ssl '"strict"'            # Full (Strict): end-to-end encryption to Netlify
setting always_use_https '"on"'   # redirect any http -> https
setting min_tls_version '"1.2"'   # refuse legacy TLS 1.0/1.1
setting tls_1_3 '"on"'            # enable TLS 1.3
setting browser_check '"on"'      # block requests with malformed/abusive headers
setting security_level '"medium"' # challenge known-bad IP reputation
setting always_online '"off"'

echo "== 2. Deploy managed WAF rulesets (Pro) =="
# Cloudflare Managed Ruleset + OWASP Core Ruleset, deployed on the firewall phase.
# These are the signature-based SQLi / XSS / RCE blockers Pro unlocks.
res=$(curl -s -X PUT \
  "$API/zones/$CF_ZONE_ID/rulesets/phases/http_request_firewall_managed/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{
    "name":"XOS managed WAF",
    "rules":[
      {"action":"execute","expression":"true","description":"Cloudflare Managed Ruleset",
       "action_parameters":{"id":"efb7b8c949ac4650a09736fc376e9aee"}},
      {"action":"execute","expression":"true","description":"Cloudflare OWASP Core Ruleset",
       "action_parameters":{"id":"4814384a9e5d4991b9815dcfc25d2f1f"}}
    ]}')
if ok "$res"; then echo "  ✓ Cloudflare Managed Ruleset + OWASP Core Ruleset deployed"
else echo "  ✗ managed rulesets -> $(grep -o '"message":"[^"]*"' <<<"$res" | head -3)"; fi

echo
echo "Done. Verify in the dashboard:"
echo "  Security -> Security rules -> Managed rules  (should list 2 rulesets)"
echo "  SSL/TLS  -> Overview                         (mode = Full (Strict))"
echo
echo "Still worth doing by hand (1 click each, not in this script):"
echo "  - Security -> Bots -> Bot Fight Mode = ON"
echo "  - DNS -> Settings -> Enable DNSSEC (then add the DS record at your registrar)"
echo "  - The custom 'Block exploit probes' rule + the /api rate-limit rule"
echo "  - Supabase: Auth CAPTCHA + Leaked Password Protection (auth is NOT behind CF)"
echo
echo "REMINDER: revoke the API token you just used."
