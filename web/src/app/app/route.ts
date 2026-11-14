// orbit.unifesto.app/app: one link (and one QR code) for both stores.
// iPhone and iPad go to the App Store, Android to Google Play, everything else home.
// The listings are still the live Unifesto app; switch both to Orbit's (com.unifesto.orbit, plan
// section 9) once those are approved.
const APP_STORE = "https://apps.apple.com/in/app/unifesto-discover-events/id6767165496";
const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.unifesto.app";

export function GET(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  const target = /iPhone|iPad|iPod/.test(ua) ? APP_STORE : /Android/.test(ua) ? PLAY_STORE : new URL("/", request.url);
  return Response.redirect(target, 302);
}
