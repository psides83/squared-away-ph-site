import webpush from "web-push";
import { writeFile } from "node:fs/promises";
const keys = webpush.generateVAPIDKeys();
const file = new URL("../.env.push.local", import.meta.url);
await writeFile(
  file,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=https://squaredawayperformancehorses.vercel.app\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created .env.push.local (Git-ignored, owner-readable). Copy its three values into Vercel Production, then redeploy. Keep the private key secret and reuse this key pair.",
);
