// Sets a new password for an account: node scripts/reset-password.mjs kund@mail.se NyttLosen123
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("Använd: node scripts/reset-password.mjs <e-post> <nytt lösenord, minst 8 tecken>");
  process.exit(1);
}

const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "accounts.json");
const store = JSON.parse(readFileSync(file, "utf8"));
const account = store.accounts.find((a) => a.email === email.trim().toLowerCase());
if (!account) {
  console.error(`Inget konto med e-posten ${email}.`);
  process.exit(1);
}

const salt = randomBytes(16);
account.passwordHash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
const tmp = `${file}.reset.tmp`;
writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
renameSync(tmp, file);
console.log(`Nytt lösenord satt för ${account.email}.`);
