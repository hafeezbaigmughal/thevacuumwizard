import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..");
const apiVersion = "2026-07";
const command = process.argv[2] || "audit";

async function loadJson(name) {
  return JSON.parse(await readFile(resolve(root, "data", name), "utf8"));
}

async function loadEnv() {
  const content = await readFile(resolve(repoRoot, ".env.migration.local"), "utf8");
  return Object.fromEntries(content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

function decodeHtml(value = "") {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function normalizeHandle(value = "") {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Preserve malformed source text. */ }
  return decoded.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function shopifyUrl(sourceUrl, title) {
  if (sourceUrl === "#") {
    if (title === "Products") return "/collections/all";
    if (title === "Services") return "/pages/dyson-vacuum-repairs-bath-bristol";
    return "/";
  }

  const source = new URL(sourceUrl, "https://thevacuumwizard.co.uk");
  const path = source.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return "/";
  if (path === "blog") return "/blogs/articles";
  if (["cart", "checkout", "account", "search"].includes(path)) return `/${path}`;
  if (path === "my-account") return "/account";

  const parts = path.split("/");
  if (parts[0] === "product-category") return `/collections/${parts.at(-1)}`;
  if (parts[0] === "product") return `/products/${normalizeHandle(parts.at(-1))}`;
  if (parts[0] === "articles") return `/blogs/articles/${normalizeHandle(parts.at(-1))}`;
  return `/pages/${normalizeHandle(parts.at(-1))}`;
}

const config = await loadEnv();
const shop = config.SHOPIFY_STORE?.replace(/^https?:\/\//, "").replace(/\/$/, "");
if (!shop?.endsWith(".myshopify.com") || !config.SHOPIFY_CLIENT_ID || !config.SHOPIFY_CLIENT_SECRET) throw new Error("Shopify migration credentials are incomplete.");

const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.SHOPIFY_CLIENT_ID, client_secret: config.SHOPIFY_CLIENT_SECRET }),
});
const token = await tokenResponse.json();
if (!tokenResponse.ok || !token.access_token) throw new Error(`Shopify authentication failed: ${token.error_description || token.error || tokenResponse.status}`);

const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token.access_token },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(`Shopify GraphQL failed: ${JSON.stringify(payload.errors || payload)}`);
  return payload.data;
}

function assertUserErrors(payload, operation) {
  if (payload.userErrors?.length) throw new Error(`${operation}: ${JSON.stringify(payload.userErrors)}`);
}

async function getMenus() {
  const data = await graphql(`query MigrationMenus {
    menus(first: 50) {
      nodes { id handle title items { id title type url items { id title type url } } }
    }
  }`);
  return data.menus.nodes;
}

async function getMenuByHandle(handle) {
  const data = await graphql(`query MigrationMenuByHandle($handle: String!) {
    menu(handle: $handle) {
      id
      handle
      title
      items { id title type url items { id title type url } }
    }
  }`, { handle });
  return data.menu;
}

const [sourceMenus, sourceItems] = await Promise.all([loadJson("menus.json"), loadJson("menu-items.json")]);
const menuTargets = new Map([
  [18, { handle: "main-menu", title: "Main menu" }],
  [19, { handle: "useful-links", title: "Useful Links" }],
  [20, { handle: "footer-bottom-menu", title: "Footer Bottom Menu" }],
]);

function buildItems(menuId, parent = 0) {
  return sourceItems.filter((item) => item.menus === menuId && item.parent === parent)
    .sort((left, right) => left.menu_order - right.menu_order)
    .map((item) => {
      const title = decodeHtml(item.title.raw || item.title.rendered);
      const children = buildItems(menuId, item.id);
      return {
        title,
        type: "HTTP",
        url: shopifyUrl(item.url, title),
        ...(children.length ? { items: children } : {}),
      };
    });
}

const desiredMenus = sourceMenus.map((menu) => ({
  sourceId: menu.id,
  ...menuTargets.get(menu.id),
  items: buildItems(menu.id),
})).filter((menu) => menu.handle);

let existingMenus = await getMenus();
console.log(JSON.stringify({
  command,
  existingMenus: existingMenus.map(({ handle, title, items }) => ({ handle, title, items: items.length })),
  desiredMenus: desiredMenus.map(({ handle, title, items }) => ({ handle, title, items: items.length })),
}, null, 2));

if (command === "audit") process.exit(0);
if (command !== "import" && command !== "verify") throw new Error(`Unknown command: ${command}`);

if (command === "import") {
  const existingByHandle = new Map(existingMenus.map((menu) => [menu.handle, menu]));
  const importedByHandle = new Map();
  for (const desired of desiredMenus) {
    const existing = existingByHandle.get(desired.handle);
    if (existing) {
      const data = await graphql(`mutation UpdateMigrationMenu($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
        menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
          menu { id handle title items { id title url } }
          userErrors { field message }
        }
      }`, { id: existing.id, title: desired.title, handle: desired.handle, items: desired.items });
      assertUserErrors(data.menuUpdate, `menuUpdate ${desired.handle}`);
      importedByHandle.set(desired.handle, data.menuUpdate.menu);
    } else {
      const data = await graphql(`mutation CreateMigrationMenu($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
        menuCreate(title: $title, handle: $handle, items: $items) {
          menu { id handle title items { id title url } }
          userErrors { field message }
        }
      }`, { title: desired.title, handle: desired.handle, items: desired.items });
      assertUserErrors(data.menuCreate, `menuCreate ${desired.handle}`);
      importedByHandle.set(desired.handle, data.menuCreate.menu);
    }
    const imported = importedByHandle.get(desired.handle);
    console.log(`Imported menu: ${desired.title} (${imported?.handle || desired.handle})`);
  }
  existingMenus = await getMenus();
  for (const desired of desiredMenus) {
    const directMenu = await getMenuByHandle(desired.handle);
    if (directMenu) importedByHandle.set(desired.handle, directMenu);
  }
  existingMenus = [
    ...existingMenus.filter((menu) => !importedByHandle.has(menu.handle)),
    ...importedByHandle.values(),
  ];
}

function flatten(items) {
  return items.flatMap((item) => [{ title: item.title, url: new URL(item.url, `https://${shop}`).pathname }, ...flatten(item.items || [])]);
}

const finalByHandle = new Map(existingMenus.map((menu) => [menu.handle, menu]));
if (command === "verify") {
  for (const desired of desiredMenus) {
    const directMenu = await getMenuByHandle(desired.handle);
    if (directMenu) finalByHandle.set(desired.handle, directMenu);
  }
}
const verification = desiredMenus.map((desired) => {
  const actual = finalByHandle.get(desired.handle);
  const expectedItems = flatten(desired.items);
  const actualItems = flatten(actual?.items || []);
  return { handle: desired.handle, exists: Boolean(actual), expectedItems: expectedItems.length, actualItems: actualItems.length, matches: JSON.stringify(actualItems) === JSON.stringify(expectedItems) };
});
const report = { completedAt: new Date().toISOString(), verification };
await mkdir(resolve(root, "reports"), { recursive: true });
await writeFile(resolve(root, "reports", "menu-import.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (verification.some((menu) => !menu.matches)) throw new Error("Menu verification failed.");

