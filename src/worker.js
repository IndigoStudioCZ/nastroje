// Online nástroje Indigo Studio — jeden Worker obsluhuje přehled na nastroje.indigostudio.cz,
// každý nástroj na vlastní subdoméně a rozcestník ceska-republika.indigostudio.cz.

import toolsPage from "./tools.page.html";
import { TOOL_BY_HOST, TOOL_CATALOG, TOOLS } from "./tools-data.js";
import czechRepublicPage from "./ceska-republika.page.html";
import { DIRECTORY, DIRECTORY_COUNT } from "./ceska-republika-data.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

// Náhledy lze vložit výhradně do přehledu nástrojů Indigo Studio.
const EMBED_HEADERS = { ...SECURITY_HEADERS, "Content-Security-Policy": "frame-ancestors https://nastroje.indigostudio.cz" };
delete EMBED_HEADERS["X-Frame-Options"];
EMBED_HEADERS["X-Robots-Tag"] = "noindex, follow";

const DIRECTORY_HOST = "ceska-republika.indigostudio.cz";
const CATALOG_URL = "https://nastroje.indigostudio.cz/";

// Statika, kterou smí načíst každá subdoména; ostatní soubory z public/ patří jen své stránce.
const SHARED_ASSETS = ["/favicon.svg", "/apple-touch-icon.png", "/logo-mark.svg"];
const SHARED_PREFIXES = ["/tools/fonts/", "/tools/og/"];
const TOOL_ASSETS = ["/tools/app.js", "/tools/style.css", "/tools/qr.js", "/tools/exif.js", "/tools/js-yaml.js", ...SHARED_ASSETS];
const DIRECTORY_ASSETS = ["/ceska-republika/style.css", "/ceska-republika/app.js", ...SHARED_ASSETS];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Veřejný rozcestník českých online služeb žije na vlastní subdoméně.
    if (url.hostname === DIRECTORY_HOST) {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = czechRepublicPage
          .replace("__EMBED_CLASS__", url.searchParams.get("embed") === "1" ? "embed" : "")
          .replace("__COUNT__", String(DIRECTORY_COUNT))
          .replace("__CATEGORY_COUNT__", String(DIRECTORY.length))
          .replace("__NAV__", renderDirectoryNavigation())
          .replace("__STRUCTURED_DATA__", directoryStructuredData())
          .replace("__SECTIONS__", renderDirectorySections());
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            ...(url.searchParams.get("embed") === "1" ? EMBED_HEADERS : SECURITY_HEADERS),
          },
        });
      }
      if (url.pathname === "/robots.txt") {
        return siteRobots(url.hostname);
      }
      if (url.pathname === "/sitemap.xml") {
        return siteSitemap(url.hostname);
      }
      return serveAsset(request, env, url, DIRECTORY_ASSETS);
    }

    // Každý veřejný nástroj má vlastní subdoménu, stránku a metadata.
    const tool = TOOL_BY_HOST.get(url.hostname);
    if (tool) {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const description = tool.slug === "nastroje" ? `${TOOLS.length} online nástrojů a služeb Indigo Studio s interaktivními náhledy.` : tool.description;
        const html = toolsPage
          .replaceAll("__TITLE__", escapeHtml(tool.title))
          .replaceAll("__DESCRIPTION__", escapeHtml(description))
          .replace("__EMBED_CLASS__", url.searchParams.get("embed") === "1" ? "embed" : "")
          .replace("__CATALOG__", tool.slug === "nastroje" ? renderToolCatalog() : "")
          .replace("__CATALOG_NAV__", tool.slug === "nastroje" ? renderToolNav() : "")
          .replaceAll("__OG_IMAGE__", `https://${tool.slug}.indigostudio.cz/tools/og/${tool.slug}.png`)
          .replaceAll("__OG_ALT__", escapeHtml(`${tool.title} — online nástroj Indigo Studio`))
          .replace("__STRUCTURED_DATA__", structuredData(tool, description))
          .replaceAll("__SLUG__", tool.slug);
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            ...(url.searchParams.get("embed") === "1" ? EMBED_HEADERS : SECURITY_HEADERS),
          },
        });
      }
      if (tool.slug === "prevody-men" && url.pathname === "/api/kurzy") {
        return getExchangeRates();
      }
      if (url.pathname === "/robots.txt") {
        return siteRobots(url.hostname);
      }
      if (url.pathname === "/sitemap.xml") {
        return siteSitemap(url.hostname);
      }
      return serveAsset(request, env, url, TOOL_ASSETS);
    }

    // Jiná adresa (workers.dev, náhled verze) nástroj nezná — návštěvník patří na přehled.
    return Response.redirect(CATALOG_URL, 302);
  },
};

// Statika jen z povoleného seznamu, ostatní cesty na subdoménách neexistují.
async function serveAsset(request, env, url, allowed) {
  if (!allowed.includes(url.pathname) && !SHARED_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    return new Response("Stránka nenalezena.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
  }
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function siteRobots(hostname) {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: https://${hostname}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS },
  });
}

function siteSitemap(hostname) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${hostname}/</loc></url></urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=86400", ...SECURITY_HEADERS },
  });
}

const CATALOG_NAMES = new Map([...TOOLS.map(([slug, title]) => [slug, title]), ["ceska-republika", "Česká republika"]]);

function renderToolCatalog() {
  return TOOL_CATALOG.map(([group, slugs]) => `<section class="catalog-section"><h2>${escapeHtml(group)}</h2><div class="catalog-grid">${slugs.map(slug => {
    const title = CATALOG_NAMES.get(slug);
    const url = `https://${slug}.indigostudio.cz/`;
    return `<article class="catalog-card" id="${slug}"><div class="catalog-card-head"><h3>${escapeHtml(title)}</h3><a href="${url}" aria-label="Otevřít ${escapeHtml(title)} samostatně">Otevřít <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5M8 5h7v7"/></svg></a></div><iframe src="${url}?embed=1" title="${escapeHtml(title)} — živý náhled" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="clipboard-write; bluetooth; autoplay" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"></iframe></article>`;
  }).join("")}</div></section>`).join("");
}

// Svislá lišta pro rychlý přesun mezi kartami; skupiny odděluje mezera.
function renderToolNav() {
  return `<nav class="rail" aria-label="Rychlá navigace mezi nástroji"><ol>${TOOL_CATALOG.map(([group, slugs]) => `<li><ol aria-label="${escapeHtml(group)}">${slugs.map(slug => `<li><a href="#${slug}"><span>${escapeHtml(CATALOG_NAMES.get(slug))}</span></a></li>`).join("")}</ol></li>`).join("")}</ol></nav>`;
}

function structuredData(tool, description) {
  const url = `https://${tool.slug}.indigostudio.cz/`;
  const publisher = { "@type": "Organization", name: "Indigo Studio", url: "https://indigostudio.cz/" };
  const data = tool.slug === "nastroje" ? {
    "@context": "https://schema.org", "@type": "CollectionPage", name: tool.title, description, url,
    inLanguage: "cs-CZ", publisher,
    mainEntity: { "@type": "ItemList", itemListElement: TOOL_CATALOG.flatMap(([, slugs]) => slugs).map((slug, index) => ({
      "@type": "ListItem", position: index + 1, name: slug === "ceska-republika" ? "Česká republika" : TOOLS.find(item => item[0] === slug)?.[1], url: `https://${slug}.indigostudio.cz/`,
    })) },
  } : {
    "@context": "https://schema.org", "@type": "WebApplication", name: tool.title, description, url,
    inLanguage: "cs-CZ", browserRequirements: "Moderní webový prohlížeč", applicationCategory: "UtilitiesApplication",
    operatingSystem: "Web", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "CZK" }, publisher,
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function directoryStructuredData() {
  const data = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: "Česká republika — rozcestník online služeb",
    description: "Odkazy na české úřady, zdravotní a komerční pojišťovny, dopravu, operátory a streamovací služby.",
    url: "https://ceska-republika.indigostudio.cz/", inLanguage: "cs-CZ",
    publisher: { "@type": "Organization", name: "Indigo Studio", url: "https://indigostudio.cz/" },
    mainEntity: { "@type": "ItemList", itemListElement: DIRECTORY.flatMap(section => section.items).map(([name, url], index) => ({
      "@type": "ListItem", position: index + 1, name, url,
    })) },
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function renderDirectoryNavigation() {
  return `<ul>${DIRECTORY.map(section => `<li data-nav-id="${escapeHtml(section.id)}"><a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`).join("")}</ul>`;
}

function renderDirectorySections() {
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M8 5h11v11"/></svg>';
  return DIRECTORY.map(section => {
    const items = section.items.map(([name, href, description]) => {
      const domain = new URL(href).hostname.replace(/^www\./, "");
      return `<a class="service" href="${escapeHtml(href)}"><span><strong>${escapeHtml(name)}</strong><em>${escapeHtml(description)}</em><small>${escapeHtml(domain)}</small></span>${arrow}</a>`;
    }).join("");
    return `<section class="directory-section" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-title"><div class="section-head"><div><h2 id="${escapeHtml(section.id)}-title">${escapeHtml(section.title)}</h2><p>${escapeHtml(section.intro)}</p></div><small>${section.items.length} odkazů</small></div><div class="service-list">${items}</div></section>`;
  }).join("");
}

// ECB vydává referenční kurzy v pracovní dny. Krátká cache šetří požadavky.
async function getExchangeRates() {
  try {
    const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
    if (!response.ok) throw new Error("ECB nedostupná");
    const xml = await response.text();
    const date = xml.match(/time=['"]([^'"]+)['"]/i)?.[1];
    const rates = { EUR: 1 };
    for (const match of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
      rates[match[1]] = Number(match[2]);
    }
    if (!date || !rates.CZK || !rates.USD) throw new Error("Neplatná data ECB");
    return new Response(JSON.stringify({ date, rates }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600", ...SECURITY_HEADERS },
    });
  } catch (error) {
    console.error("ECB rates:", error?.message || error);
    return json({ error: "Kurzy se nyní nepodařilo načíst." }, 503);
  }
}
