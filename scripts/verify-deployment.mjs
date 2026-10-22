// Read-only public deployment checks. Never signs in or changes application records.
const target = process.argv[2];
if (!target)
  throw new Error(
    "Provide the deployment URL: npm run verify:deployment -- https://your-site.vercel.app",
  );
const base = new URL(target);
if (
  !["https:", "http:"].includes(base.protocol) ||
  base.username ||
  base.password
)
  throw new Error("Use an HTTP(S) URL without credentials.");
base.pathname = "/";
base.search = "";
base.hash = "";
let failures = 0;
async function check(label, run) {
  try {
    await run();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${label}: ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function request(path) {
  return fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
}
await check("Sign-in page is available and private", async () => {
  const response = await request("/login");
  assert(response.status === 200, `HTTP ${response.status}`);
  const cache = response.headers.get("cache-control") || "";
  assert(
    cache.includes("private") && cache.includes("no-store"),
    "Missing private/no-store caching policy",
  );
  const html = await response.text();
  assert(
    html.includes("Email address") && html.includes("Sign in"),
    "Sign-in form missing",
  );
  assert(html.includes("/manifest.webmanifest"), "Manifest link missing");
});
await Promise.all(
  [
    "/admin",
    "/portal",
    "/admin/training/00000000-0000-0000-0000-000000000001",
  ].map((path) =>
    check(`Signed-out protection: ${path}`, async () => {
      const response = await request(path);
      assert(
        [303, 307, 308].includes(response.status),
        `Expected redirect, received HTTP ${response.status}`,
      );
      const location = new URL(response.headers.get("location") || "/", base);
      assert(
        location.origin === base.origin && location.pathname === "/login",
        "Expected same-site sign-in redirect",
      );
      assert(
        (response.headers.get("cache-control") || "").includes("no-store"),
        "Protected response permits caching",
      );
    }),
  ),
);
await check("Install manifest and every declared PNG icon", async () => {
  const response = await request("/manifest.webmanifest");
  assert(response.status === 200, `HTTP ${response.status}`);
  const manifest = await response.json();
  assert(
    manifest.display === "standalone" && manifest.start_url === "/login",
    "Unexpected install configuration",
  );
  assert(manifest.icons?.length >= 2, "Missing app icons");
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, base);
    assert(
      url.origin === base.origin && icon.type === "image/png",
      "Unexpected icon origin or format",
    );
    const asset = await request(url.pathname);
    assert(asset.status === 200, `Icon ${icon.src}: HTTP ${asset.status}`);
    const bytes = Buffer.from(await asset.arrayBuffer());
    assert(
      bytes.length >= 24 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      `Invalid PNG: ${icon.src}`,
    );
    assert(
      `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` === icon.sizes,
      `Incorrect dimensions: ${icon.src}`,
    );
  }
});
console.log(
  "Authenticated database access, migration history, uploads, billing actions, and device installation require separate checks.",
);
process.exitCode = failures ? 1 : 0;
