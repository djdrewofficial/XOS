import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // PUBLIC routes: client signing links + machine endpoints (webhook/cron do
  // their own auth — Mailgun HMAC and the CRON_SECRET bearer token; /api/mobile
  // verifies the XOS Mobile app's Supabase JWT itself)
  const isPublic =
    pathname.startsWith("/sign/") ||
    pathname.startsWith("/pay/") ||
    pathname.startsWith("/welcome/") ||
    pathname.startsWith("/proposal/") ||
    pathname.startsWith("/vibo/") ||
    pathname.startsWith("/api/vibo/") ||
    pathname.startsWith("/api/mailgun/") ||
    pathname.startsWith("/api/highlevel/") ||
    pathname.startsWith("/api/paypal/") ||
    pathname.startsWith("/api/pay/") ||
    pathname.startsWith("/api/places") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/api/cron/");
  if (isPublic) return response;

  const isLoginPage = pathname.startsWith("/login");
  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
