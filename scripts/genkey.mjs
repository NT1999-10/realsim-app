// ライセンスキー発行: npm run genkey [枚数]
// SALT は src/plan.js と必ず同じ値にすること
import crypto from "crypto";

const SALT = "genjitsuha-v1-salt-7f3a";
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rnd = (n) => [...crypto.randomBytes(n)].map((b) => CHARS[b % CHARS.length]).join("");

const count = Math.max(1, parseInt(process.argv[2] || "1", 10));
for (let i = 0; i < count; i++) {
  const body = rnd(8);
  const check = crypto.createHash("sha256").update(body + SALT)
    .digest("hex").slice(0, 6).toUpperCase();
  console.log(`RP-${body.slice(0, 4)}-${body.slice(4)}-${check}`);
}
