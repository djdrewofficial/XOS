package resettemplate

import (
	"html/template"
	"os"
	"strings"
	"testing"
)

func render(t *testing.T, src, redirect, token string) string {
	t.Helper()
	tpl, err := template.New("reset").Parse(src)
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	if err := tpl.Execute(&b, map[string]any{"RedirectTo": redirect, "TokenHash": token}); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

func branded(t *testing.T) string {
	t.Helper()
	src, err := os.ReadFile("reset-password.branded.html")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), "ConfirmationURL") {
		t.Fatal("template must not use ConfirmationURL")
	}
	return string(src)
}

func TestCurrentCustomSchemeBecomesZgotmplZ(t *testing.T) {
	const current = `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>`
	out := render(t, current, "xpressclient://auth/reset", "fixtureToken_123")
	if !strings.Contains(out, `href="#ZgotmplZ?token_hash=fixtureToken_123&type=recovery"`) {
		t.Fatalf("expected the custom scheme to be stripped, got %s", out)
	}
}

func TestMobileRedirectUsesTheHttpsBridge(t *testing.T) {
	out := render(t, branded(t), "xpressclient://auth/reset", "fixtureToken_123")
	if strings.Contains(out, "#ZgotmplZ") || strings.Contains(out, "xpressclient:") {
		t.Fatalf("mobile href was not a plain https bridge: %s", out)
	}
	const want = "https://xos.xpressdjs.com/auth/reset?token_hash=fixtureToken_123&type=recovery"
	if !strings.Contains(out, want) {
		t.Fatalf("missing bridge href in %s", out)
	}
	if !strings.Contains(out, "Reset your password") || !strings.Contains(out, "#4b328e") {
		t.Fatal("branded copy or color was dropped")
	}
}

func TestStaffRedirectStaysOnSetPassword(t *testing.T) {
	out := render(t, branded(t), "https://xos.xpressdjs.com/auth/set-password", "fixtureToken_123")
	if strings.Contains(out, "#ZgotmplZ") || strings.Contains(out, "/auth/reset") {
		t.Fatalf("staff href changed: %s", out)
	}
	const want = "https://xos.xpressdjs.com/auth/set-password?token_hash=fixtureToken_123&type=recovery"
	if !strings.Contains(out, want) {
		t.Fatalf("missing staff href in %s", out)
	}
}

func TestPreviewStaffHostStaysCompatible(t *testing.T) {
	out := render(t, branded(t), "https://deploy-preview-49--xos-xpressdjs.netlify.app/auth/set-password", "fixtureToken_123")
	if strings.Contains(out, "#ZgotmplZ") || strings.Contains(out, "xos.xpressdjs.com/auth/reset") {
		t.Fatalf("preview staff href changed: %s", out)
	}
}

func TestTokenIsQueryEscaped(t *testing.T) {
	out := render(t, branded(t), "xpressclient://auth/reset", `a<b>&"' `)
	if strings.Contains(out, "#ZgotmplZ") || strings.Contains(out, "<b>") || strings.Contains(out, `&"'`) {
		t.Fatalf("token was not escaped: %s", out)
	}
	if !strings.Contains(out, "token_hash=a%3cb%3e%26%22%27%20") {
		t.Fatalf("unexpected encoding: %s", out)
	}
}
