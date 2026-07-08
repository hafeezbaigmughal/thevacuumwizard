import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(root, "data");
const siteUrl = "https://thevacuumwizard.co.uk";
const wpApi = `${siteUrl}/wp-json/wp/v2`;
const wooApi = `${siteUrl}/wp-json/wc/store/v1`;

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return { data: await response.json(), headers: response.headers };
}

async function getAll(baseUrl, endpoint, params = {}) {
  const records = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL(`${baseUrl}/${endpoint}`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await getJson(url);
    records.push(...response.data);
    totalPages = Number(response.headers.get("x-wp-totalpages") || 1);
    page += 1;
  } while (page <= totalPages);

  return records;
}

async function save(name, value) {
  await writeFile(resolve(outputDir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

await mkdir(outputDir, { recursive: true });

const [
  wpProducts,
  wooProducts,
  pages,
  articles,
  testimonials,
  productCategories,
  productTags,
  media,
] = await Promise.all([
  getAll(wpApi, "product", { _embed: "1", orderby: "id", order: "asc" }),
  getAll(wooApi, "products", { orderby: "id", order: "asc" }),
  getAll(wpApi, "pages", { _embed: "1", orderby: "id", order: "asc" }),
  getAll(wpApi, "articles", { _embed: "1", orderby: "id", order: "asc" }),
  getAll(wpApi, "testimonials", { _embed: "1", orderby: "id", order: "asc" }),
  getAll(wpApi, "product_cat", { orderby: "id", order: "asc" }),
  getAll(wpApi, "product_tag", { orderby: "id", order: "asc" }),
  getAll(wpApi, "media", { orderby: "id", order: "asc" }),
]);

const wooById = new Map(wooProducts.map((product) => [product.id, product]));
const products = wpProducts.map((product) => ({
  ...product,
  store: wooById.get(product.id) || null,
}));

const manifest = {
  generatedAt: new Date().toISOString(),
  source: siteUrl,
  counts: {
    products: products.length,
    productsWithStoreData: products.filter((product) => product.store).length,
    pages: pages.length,
    articles: articles.length,
    testimonials: testimonials.length,
    productCategories: productCategories.length,
    productTags: productTags.length,
    media: media.length,
  },
};

await Promise.all([
  save("manifest", manifest),
  save("products", products),
  save("pages", pages),
  save("articles", articles),
  save("testimonials", testimonials),
  save("product-categories", productCategories),
  save("product-tags", productTags),
  save("media", media),
]);

console.log(JSON.stringify(manifest, null, 2));
