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
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function graphql(query, variables = {}) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token.access_token },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    const throttled = response.status === 429 || payload.errors?.some((error) => error.extensions?.code === "THROTTLED");
    if (throttled && attempt < 6) {
      await sleep(Number(response.headers.get("retry-after") || attempt) * 1000);
      continue;
    }
    if (!response.ok || payload.errors?.length) throw new Error(`Shopify GraphQL failed: ${JSON.stringify(payload.errors || payload)}`);
    return payload.data;
  }
  throw new Error("Shopify GraphQL remained throttled after retries.");
}

function assertUserErrors(payload, operation) {
  if (payload.userErrors?.length) throw new Error(`${operation}: ${JSON.stringify(payload.userErrors)}`);
}

async function getAll(connection, fields) {
  const nodes = [];
  let cursor = null;
  do {
    const data = await graphql(`query Paginate($cursor: String) {
      ${connection}(first: 250, after: $cursor) { nodes { ${fields} } pageInfo { hasNextPage endCursor } }
    }`, { cursor });
    nodes.push(...data[connection].nodes);
    cursor = data[connection].pageInfo.hasNextPage ? data[connection].pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

function decodeHtml(value = "") {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function normalizeHandle(value = "") {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Keep malformed source handle. */ }
  return decoded.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeUrl(value) {
  if (!value) return null;
  try { return new URL(value).href; } catch { return null; }
}

const systemRoutes = new Map([
  ["shop", "/collections/all"],
  ["cart", "/cart"],
  ["checkout", "/checkout"],
  ["my-account", "/account"],
  ["home", "/"],
  ["blog", "/blogs/articles"],
]);

function rewriteLinks(html) {
  return html
    .replace(/https?:\/\/thevacuumwizard\.co\.uk/gi, "")
    .replace(/href=["']\/product\/([^"'/?#]+)\/?["']/gi, (_, slug) => `href="/products/${normalizeHandle(slug)}"`)
    .replace(/href=["']\/product-category\/([^"'/?#]+)\/?["']/gi, (_, slug) => `href="/collections/${normalizeHandle(slug)}"`)
    .replace(/href=["']\/articles\/([^"'/?#]+)\/?["']/gi, (_, slug) => `href="/blogs/articles/${normalizeHandle(slug)}"`);
}

function normalizeEscapedNewlines(html) {
  return html.replace(/\r?\\n/g, "\n").replace(/\\r/g, "");
}

function restoreWordPressMediaUrls(html) {
  return html.replace(/(^|["'\s(,])\/wp-content\//g, "$1https://thevacuumwizard.co.uk/wp-content/");
}

function cleanHtml(value = "") {
  return restoreWordPressMediaUrls(rewriteLinks(normalizeEscapedNewlines(value)))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|link|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/\[(?:contact-form-7|woocommerce|ti_wishlistsview|wp-review)[^\]]*\]/gi, "")
    .replace(/\s(?:class|id|style|data-[\w-]+|aria-[\w-]+)=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/<div>\s*<\/div>/gi, "")
    .trim();
}

function summaryFromHtml(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 300);
}

const [wpPages, wpArticles, testimonials, categories, wpProducts, productRows] = await Promise.all([
  loadJson("pages.json"),
  loadJson("articles.json"),
  loadJson("testimonials.json"),
  loadJson("product-categories.json"),
  loadJson("products.json"),
  JSON.parse(await readFile(resolve(root, "output", "shopify-product-rows.json"), "utf8")),
]);

const testimonialHtml = testimonials.map((testimonial) => `<article><h2>${decodeHtml(testimonial.title.rendered)}</h2>${cleanHtml(testimonial.content.rendered)}</article>`).join("\n");
const contentPages = wpPages.filter((page) => !systemRoutes.has(page.slug)).map((page) => ({
  source: page,
  title: decodeHtml(page.title.rendered),
  handle: normalizeHandle(page.slug),
  body: page.slug === "testimonials" ? testimonialHtml : cleanHtml(page.content.rendered),
  isPublished: page.status === "publish",
  templateSuffix: page.slug === "contact-us" ? "contact" : null,
}));

const currentScopes = await graphql(`query ContentPreflight { currentAppInstallation { accessScopes { handle } } shop { name } }`);
const scopes = new Set(currentScopes.currentAppInstallation.accessScopes.map((scope) => scope.handle));
const requiredScopes = ["read_content", "write_content", "read_online_store_navigation", "write_online_store_navigation"];
const missingScopes = requiredScopes.filter((scope) => !scopes.has(scope));
if (missingScopes.length) throw new Error(`Migration app is missing scopes: ${missingScopes.join(", ")}`);

let existingPages = await getAll("pages", "id handle title isPublished");
let existingBlogs = await getAll("blogs", "id handle title articles(first: 250) { nodes { id handle title } }");
let existingRedirects = await getAll("urlRedirects", "id path target");

console.log(JSON.stringify({
  command,
  shop: currentScopes.shop.name,
  existingPages: existingPages.length,
  existingBlogs: existingBlogs.length,
  existingRedirects: existingRedirects.length,
  sourcePages: contentPages.length,
  sourceArticles: wpArticles.length,
  sourceTestimonials: testimonials.length,
}, null, 2));

if (command === "audit") process.exit(0);
if (command !== "import") throw new Error(`Unknown command: ${command}`);

const pageByHandle = new Map(existingPages.map((page) => [page.handle, page]));
for (const [index, page] of contentPages.entries()) {
  const input = {
    title: page.title,
    handle: page.handle,
    body: page.body,
    isPublished: page.isPublished,
    ...(page.templateSuffix ? { templateSuffix: page.templateSuffix } : {}),
  };
  const existing = pageByHandle.get(page.handle);
  if (existing) {
    const data = await graphql(`mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {
      pageUpdate(id: $id, page: $page) { page { id handle title } userErrors { field message } }
    }`, { id: existing.id, page: input });
    assertUserErrors(data.pageUpdate, `pageUpdate ${page.handle}`);
  } else {
    const data = await graphql(`mutation CreatePage($page: PageCreateInput!) {
      pageCreate(page: $page) { page { id handle title } userErrors { field message } }
    }`, { page: input });
    assertUserErrors(data.pageCreate, `pageCreate ${page.handle}`);
  }
  console.log(`Imported page ${index + 1}/${contentPages.length}: ${page.title}`);
}

let blog = existingBlogs.find((item) => item.handle === "articles");
if (blog) {
  const data = await graphql(`mutation UpdateBlog($id: ID!, $blog: BlogUpdateInput!) {
    blogUpdate(id: $id, blog: $blog) { blog { id handle title } userErrors { field message } }
  }`, { id: blog.id, blog: { title: "Blogs", handle: "articles", commentPolicy: "CLOSED" } });
  assertUserErrors(data.blogUpdate, "blogUpdate articles");
  blog = { ...blog, ...data.blogUpdate.blog };
} else {
  const data = await graphql(`mutation CreateBlog($blog: BlogCreateInput!) {
    blogCreate(blog: $blog) { blog { id handle title } userErrors { field message } }
  }`, { blog: { title: "Blogs", handle: "articles", commentPolicy: "CLOSED" } });
  assertUserErrors(data.blogCreate, "blogCreate articles");
  blog = data.blogCreate.blog;
}

const currentArticles = new Map((existingBlogs.find((item) => item.handle === "articles")?.articles.nodes || []).map((article) => [article.handle, article]));
async function saveArticle(input, existing, handle) {
  const operation = existing ? "articleUpdate" : "articleCreate";
  const mutation = existing
    ? `mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) { article { id handle title } userErrors { field message } }
    }`
    : `mutation CreateArticle($article: ArticleCreateInput!) {
      articleCreate(article: $article) { article { id handle title } userErrors { field message } }
    }`;
  const variables = existing ? { id: existing.id, article: input } : { article: input };
  const data = await graphql(mutation, variables);
  const result = data[operation];
  const imageFailed = result.userErrors?.some((error) => /image upload failed/i.test(error.message));
  if (imageFailed && input.image) {
    console.warn(`Article image skipped for ${handle}: Shopify could not download ${input.image.url}`);
    const { image, ...inputWithoutImage } = input;
    const retryData = await graphql(mutation, existing ? { id: existing.id, article: inputWithoutImage } : { article: inputWithoutImage });
    assertUserErrors(retryData[operation], `${operation} ${handle}`);
    return retryData[operation].article;
  }
  assertUserErrors(result, `${operation} ${handle}`);
  return result.article;
}

for (const [index, source] of wpArticles.entries()) {
  const handle = normalizeHandle(source.slug);
  const body = cleanHtml(source.content.rendered);
  const featuredMedia = source._embedded?.["wp:featuredmedia"]?.[0];
  const input = {
    blogId: blog.id,
    title: decodeHtml(source.title.rendered),
    handle,
    body,
    summary: summaryFromHtml(body),
    author: { name: "The Vacuum Wizard" },
    isPublished: source.status === "publish",
    publishDate: `${source.date_gmt}Z`,
    tags: [],
    ...(featuredMedia?.source_url ? { image: { url: normalizeUrl(featuredMedia.source_url), altText: decodeHtml(featuredMedia.alt_text || source.title.rendered) } } : {}),
  };
  const existing = currentArticles.get(handle);
  await saveArticle(input, existing, handle);
  console.log(`Imported article ${index + 1}/${wpArticles.length}: ${input.title}`);
}

const desiredRedirects = new Map();
for (const [slug, target] of systemRoutes) if (`/${slug}` !== target) desiredRedirects.set(`/${slug}`, target);
for (const page of contentPages) desiredRedirects.set(`/${page.source.slug}`, `/pages/${page.handle}`);
for (const article of wpArticles) desiredRedirects.set(`/articles/${article.slug}`, `/blogs/articles/${normalizeHandle(article.slug)}`);
for (const category of categories) desiredRedirects.set(`/product-category/${category.slug}`, `/collections/${category.slug}`);
const productHandles = new Set(productRows.filter((row) => row.Title).map((row) => row["URL handle"]));
for (const product of wpProducts) {
  const targetHandle = normalizeHandle(product.slug);
  if (productHandles.has(targetHandle)) desiredRedirects.set(`/product/${product.slug}`, `/products/${targetHandle}`);
}

const redirectByPath = new Map(existingRedirects.map((redirect) => [redirect.path.replace(/\/$/, ""), redirect]));
let redirectIndex = 0;
for (const [path, target] of desiredRedirects) {
  redirectIndex += 1;
  const normalizedPath = path.replace(/\/$/, "") || "/";
  const existing = redirectByPath.get(normalizedPath);
  if (existing) {
    if (existing.target !== target) {
      const data = await graphql(`mutation UpdateRedirect($id: ID!, $urlRedirect: UrlRedirectInput!) {
        urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) { urlRedirect { id path target } userErrors { field message } }
      }`, { id: existing.id, urlRedirect: { path: normalizedPath, target } });
      assertUserErrors(data.urlRedirectUpdate, `urlRedirectUpdate ${normalizedPath}`);
    }
  } else {
    const data = await graphql(`mutation CreateRedirect($urlRedirect: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $urlRedirect) { urlRedirect { id path target } userErrors { field message } }
    }`, { urlRedirect: { path: normalizedPath, target } });
    assertUserErrors(data.urlRedirectCreate, `urlRedirectCreate ${normalizedPath}`);
  }
  if (redirectIndex % 25 === 0 || redirectIndex === desiredRedirects.size) console.log(`Imported redirects ${redirectIndex}/${desiredRedirects.size}`);
}

existingPages = await getAll("pages", "id handle title isPublished");
existingBlogs = await getAll("blogs", "id handle title articles(first: 250) { nodes { id handle title } }");
existingRedirects = await getAll("urlRedirects", "id path target");
const finalBlog = existingBlogs.find((item) => item.handle === "articles");
const report = {
  completedAt: new Date().toISOString(),
  pages: existingPages.length,
  importedPageHandles: contentPages.filter((page) => existingPages.some((existing) => existing.handle === page.handle)).length,
  articles: finalBlog?.articles.nodes.length || 0,
  redirects: existingRedirects.length,
  expectedRedirects: desiredRedirects.size,
};
await mkdir(resolve(root, "reports"), { recursive: true });
await writeFile(resolve(root, "reports", "content-import.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (report.importedPageHandles !== contentPages.length || report.articles < wpArticles.length) throw new Error("Content verification failed.");
