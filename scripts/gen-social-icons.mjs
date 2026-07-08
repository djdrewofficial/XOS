/* Generates self-hosted social icons into public/social/*.png from the
   FontAwesome brand set XOS already ships — so emails never depend on external
   (BeeFree) image hosting. One-time asset generation; the PNGs are committed.

   To re-run:  npm i -D @napi-rs/canvas  &&  node scripts/gen-social-icons.mjs
*/
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "fs";
import { faFacebookF, faInstagram, faTiktok, faYoutube } from "@fortawesome/free-brands-svg-icons";

const SIZE = 96; // rendered at 32px in email → 3x for crispness

const ICONS = [
  { name: "facebook", fa: faFacebookF, bg: "#1877F2", glyph: 0.5 },
  { name: "instagram", fa: faInstagram, bg: "gradient", glyph: 0.58 },
  { name: "tiktok", fa: faTiktok, bg: "#111111", glyph: 0.54 },
  { name: "youtube", fa: faYoutube, bg: "#FF0000", glyph: 0.62 },
];

mkdirSync("public/social", { recursive: true });

for (const ic of ICONS) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  // circular background
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  if (ic.bg === "gradient") {
    const g = ctx.createLinearGradient(0, SIZE, SIZE, 0);
    g.addColorStop(0, "#F58529");
    g.addColorStop(0.5, "#DD2A7B");
    g.addColorStop(1, "#8134AF");
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = ic.bg;
  }
  ctx.fill();

  // white brand glyph, scaled + centered
  const [w, h, , , path] = ic.fa.icon;
  const d = Array.isArray(path) ? path.join(" ") : path;
  const target = SIZE * ic.glyph;
  const scale = target / Math.max(w, h);
  const gw = w * scale;
  const gh = h * scale;
  ctx.save();
  ctx.translate((SIZE - gw) / 2, (SIZE - gh) / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fill(new Path2D(d));
  ctx.restore();

  writeFileSync(`public/social/${ic.name}.png`, canvas.toBuffer("image/png"));
  console.log("wrote public/social/" + ic.name + ".png");
}
