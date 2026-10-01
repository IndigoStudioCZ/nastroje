// Kontrola před nasazením (npm run check, běží i v CI):
// 1. seznam domén ve wrangler.toml, katalog a obrázky OG odpovídají src/tools-data.js,
// 2. naše skripty jdou přeložit,
// 3. Worker spuštěný lokálně odpoví na každé ze subdomén vlastní stránkou.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { unstable_startWorker } from "wrangler";
import { TOOLS, TOOL_CATALOG } from "../src/tools-data.js";

const DIRECTORY = "ceska-republika";
const DOMAIN = "indigostudio.cz";
const failures = [];
const fail = message => failures.push(message);

// ----- 1. Data a konfigurace -----
const slugs = [...TOOLS.map(([slug]) => slug), DIRECTORY];
const routes = [...readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").matchAll(/pattern = "([^"]+)"/g)].map(match => match[1]);
const hosts = slugs.map(slug => `${slug}.${DOMAIN}`);
for (const host of hosts) if (!routes.includes(host)) fail(`wrangler.toml: chybí doména ${host}`);
for (const route of routes) if (!hosts.includes(route)) fail(`wrangler.toml: doména ${route} nemá nástroj v src/tools-data.js`);

const catalog = TOOL_CATALOG.flatMap(([, group]) => group);
for (const slug of catalog) if (!slugs.includes(slug)) fail(`TOOL_CATALOG: neznámý nástroj ${slug}`);
for (const slug of slugs) {
  if (slug === "nastroje") continue;
  const count = catalog.filter(item => item === slug).length;
  if (count !== 1) fail(`TOOL_CATALOG: ${slug} je v přehledu ${count}×, má být jednou`);
}
for (const slug of slugs) {
  if (!existsSync(new URL(`../public/tools/og/${slug}.png`, import.meta.url))) fail(`chybí obrázek OG public/tools/og/${slug}.png (npm run og)`);
}

// ----- 2. Syntaxe našich skriptů (knihovny třetích stran se nekontrolují) -----
const ours = [
  ...readdirSync(new URL("../src/", import.meta.url)).filter(name => name.endsWith(".js")).map(name => `src/${name}`),
  "public/tools/app.js", "public/tools/exif.js", "public/ceska-republika/app.js",
  ...readdirSync(new URL("../scripts/", import.meta.url)).filter(name => name.endsWith(".mjs")).map(name => `scripts/${name}`),
];
for (const file of ours) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) fail(`${file}: ${result.stderr.trim().split("\n").slice(0, 4).join(" ")}`);
}

// ----- 3. Lokální Worker na každé subdoméně -----
// wrangler dev posílá všechny požadavky na jednu adresu (dev.origin), proto se
// Worker spouští pro každou doménu zvlášť — trvá to zlomek sekundy.
async function withHost(hostname, run) {
  const worker = await unstable_startWorker({
    config: new URL("../wrangler.toml", import.meta.url).pathname,
    dev: { server: { port: 0 }, inspector: false, logLevel: "warn", origin: { hostname, secure: true } },
  });
  try {
    await worker.ready;
    await run(path => worker.fetch(`http://localhost${path}`, { redirect: "manual" }));
  } finally {
    await worker.dispose();
  }
}

const titles = new Map([...TOOLS.map(([slug, title]) => [slug, `${title} — Indigo Studio`]), [DIRECTORY, "Česká republika — rozcestník online služeb | Indigo Studio"]]);
for (const slug of slugs) {
  const host = `${slug}.${DOMAIN}`;
  await withHost(host, async get => {
    const res = await get("/");
    const html = await res.text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
    if (res.status !== 200) return fail(`${host}/: stav ${res.status}`);
    if (title !== titles.get(slug)) fail(`${host}/: titulek „${title}", čekal jsem „${titles.get(slug)}"`);
    if (!html.includes(`content="https://${host}/tools/og/${slug}.png"`)) fail(`${host}/: og:image nemíří na vlastní doménu`);
    if (html.includes("__")) fail(`${host}/: v HTML zůstal nevyplněný zástupný text __…__`);
    if (slug === "nastroje") {
      const cards = html.match(/class="catalog-card"/g)?.length ?? 0;
      if (cards !== catalog.length) fail(`${host}/: přehled má ${cards} karet, katalog ${catalog.length}`);
    }
  });
}

// Statika, robots, sitemap, vkládání do přehledu a neznámá adresa — stačí na jedné doméně.
await withHost(`kalkulacka.${DOMAIN}`, async get => {
  const expect = async (path, status, check = () => true, label = "") => {
    const res = await get(path);
    if (res.status !== status || !check(res)) fail(`kalkulacka.${DOMAIN}${path}: stav ${res.status}${label}`);
    await res.arrayBuffer();
  };
  await expect("/tools/app.js", 200);
  await expect("/tools/style.css", 200);
  await expect("/tools/og/kalkulacka.png", 200, res => res.headers.get("content-type") === "image/png", " nebo špatný typ");
  await expect("/tools/fonts/dm-sans-latin.woff2", 200);
  await expect("/ceska-republika/app.js", 404);
  await expect("/wrangler.toml", 404);
  await expect("/robots.txt", 200);
  await expect("/sitemap.xml", 200);
  await expect("/?embed=1", 200, res => res.headers.get("content-security-policy") === "frame-ancestors https://nastroje.indigostudio.cz" && !res.headers.get("x-frame-options"), " nebo chybí CSP pro náhled");
  await expect("/", 200, res => res.headers.get("x-frame-options") === "DENY", " nebo chybí X-Frame-Options");
});
await withHost("example.com", async get => {
  const res = await get("/");
  if (res.status !== 302 || res.headers.get("location") !== "https://nastroje.indigostudio.cz/") fail(`neznámá adresa: stav ${res.status} → ${res.headers.get("location")}`);
});

if (failures.length) {
  console.error(`Kontrola selhala (${failures.length}):\n${failures.map(message => `  • ${message}`).join("\n")}`);
  process.exit(1);
}
console.log(`V pořádku: ${hosts.length} domén, ${catalog.length} karet v přehledu, ${ours.length} skriptů.`);
