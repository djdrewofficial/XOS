/* Browser fallback for https://xos.xpressdjs.com/auth/reset. The couple app
   asks Supabase to put this path in {{ .RedirectTo }}. When the app is not
   installed, this page finishes the reset. It is the same form as
   /auth/set-password, including the staff MFA step. The token stays in the
   query until that page verifies it. */
export { default } from "../set-password/page";
