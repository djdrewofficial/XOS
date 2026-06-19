# Cloudflare hardening for the xpressdjs.com zone (Pro). Native PowerShell.
# The token is prompted hidden (not echoed, not saved in history). Idempotent.
#
# Token needs (Zone scope, xpressdjs.com only): Zone Settings:Edit + Zone WAF:Edit
# Zone ID: dash -> xpressdjs.com -> Overview -> right rail "Zone ID".
#
# Run:   .\scripts\cf-harden.ps1 -ZoneId "08a10017dc6b44491ab65e5712c444cc"
#   (you'll be prompted for the token). Revoke the token when done.

param(
  [string]$ZoneId = $env:CF_ZONE_ID,
  [string]$Token  = $env:CF_API_TOKEN
)
if (-not $ZoneId) { $ZoneId = Read-Host "Cloudflare Zone ID" }
if (-not $Token) {
  $sec = Read-Host "Cloudflare API token (hidden)" -AsSecureString
  $Token = [System.Net.NetworkCredential]::new('', $sec).Password
}

$api = "https://api.cloudflare.com/client/v4"
$headers = @{ Authorization = "Bearer $Token" }

function Get-CFError($err) {
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) { return $err.ErrorDetails.Message }
  try {
    $s = New-Object System.IO.StreamReader($err.Exception.Response.GetResponseStream())
    return $s.ReadToEnd()
  } catch { return $err.Exception.Message }
}

function Set-CFSetting($name, $value) {
  $body = @{ value = $value } | ConvertTo-Json
  try {
    $r = Invoke-RestMethod -Method Patch -Uri "$api/zones/$ZoneId/settings/$name" `
         -Headers $headers -ContentType "application/json" -Body $body
    if ($r.success) { Write-Host "  OK  $name = $value" -ForegroundColor Green }
    else { Write-Host "  ERR $name -> $($r.errors.message)" -ForegroundColor Red }
  } catch {
    $msg = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    Write-Host "  ERR $name -> $msg" -ForegroundColor Red
  }
}

Write-Host "== 1. TLS / HTTPS settings =="
Set-CFSetting "ssl" "strict"             # Full (Strict): encrypted end-to-end to Netlify
Set-CFSetting "always_use_https" "on"
Set-CFSetting "min_tls_version" "1.2"
Set-CFSetting "tls_1_3" "on"
Set-CFSetting "browser_check" "on"
Set-CFSetting "security_level" "medium"

Write-Host "== 2. Deploy managed WAF rulesets (Pro) =="
# Entrypoint update takes only { rules: [...] } — no top-level name.
$body = @{
  rules = @(
    @{ action="execute"; expression="true"; description="Cloudflare Managed Ruleset";
       action_parameters=@{ id="efb7b8c949ac4650a09736fc376e9aee" } },
    @{ action="execute"; expression="true"; description="Cloudflare OWASP Core Ruleset";
       action_parameters=@{ id="4814384a9e5d4991b9815dcfc25d2f1f" } }
  )
} | ConvertTo-Json -Depth 6
try {
  $r = Invoke-RestMethod -Method Put `
       -Uri "$api/zones/$ZoneId/rulesets/phases/http_request_firewall_managed/entrypoint" `
       -Headers $headers -ContentType "application/json" -Body $body
  if ($r.success) { Write-Host "  OK  Managed + OWASP rulesets deployed" -ForegroundColor Green }
  else { Write-Host "  ERR $($r.errors.message)" -ForegroundColor Red }
} catch {
  Write-Host "  ERR managed rulesets -> $(Get-CFError $_)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Done. Verify: Security -> Security rules -> Managed rules (2 rulesets); SSL/TLS = Full (Strict)."
Write-Host "Still 1-click each by hand: Bot Fight Mode ON; DNSSEC; the custom exploit + rate-limit rules;"
Write-Host "Supabase Auth CAPTCHA + Leaked Password Protection. Then REVOKE the API token."
