import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..");
const apiVersion = "2026-07";
const command = process.argv[2] || "audit";
const confirmation = process.argv.find((argument) => argument.startsWith("--confirm="))?.split("=")[1];

async function loadEnv(path) {
  const content = await readFile(path, "utf8");
  return Object.fromEntries(content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

let config = {};
let shop = "";
let authentication = null;
let endpoint = "";

async function authenticate() {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.SHOPIFY_CLIENT_ID,
      client_secret: config.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    const pageTitle = responseText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
    throw new Error(`Shopify authentication failed (${response.status}): ${pageTitle || "non-JSON response"}`);
  }
  if (!response.ok || !payload.access_token) throw new Error(`Shopify authentication failed: ${payload.error_description || payload.error || response.status}`);
  return payload;
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function graphql(query, variables = {}) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": authentication.access_token,
      },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    const throttled = response.status === 429 || payload.errors?.some((error) => error.extensions?.code === "THROTTLED");
    if (throttled && attempt < 6) {
      await sleep(Number(response.headers.get("retry-after") || attempt) * 1000);
      continue;
    }
    if (!response.ok || payload.errors?.length) {
      throw new Error(`Shopify GraphQL failed: ${JSON.stringify(payload.errors || payload)}`);
    }
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
      ${connection}(first: 250, after: $cursor) {
        nodes { ${fields} }
        pageInfo { hasNextPage endCursor }
      }
    }`, { cursor });
    nodes.push(...data[connection].nodes);
    cursor = data[connection].pageInfo.hasNextPage ? data[connection].pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

async function preflight() {
  const data = await graphql(`query MigrationPreflight {
    shop { name }
    currentAppInstallation { accessScopes { handle } }
    locations(first: 20) { nodes { id name isActive } }
    publications(first: 20) { nodes { id name app { title } } }
    productSetInput: __type(name: "ProductSetInput") { inputFields { name } }
    collectionCreateInput: __type(name: "CollectionCreateInput") { inputFields { name } }
  }`);
  const scopes = new Set(data.currentAppInstallation.accessScopes.map((scope) => scope.handle));
  const requiredScopes = ["read_products", "write_products", "read_inventory", "write_inventory", "read_locations", "read_files", "write_files", "read_publications", "write_publications"];
  const missingScopes = requiredScopes.filter((scope) => !scopes.has(scope));
  if (missingScopes.length) throw new Error(`Migration app is missing scopes: ${missingScopes.join(", ")}`);
  if (!data.productSetInput?.inputFields.some((field) => field.name === "variants")) throw new Error("The selected Shopify API version does not expose productSet variants.");
  if (!data.collectionCreateInput?.inputFields.some((field) => field.name === "sources")) throw new Error("The selected Shopify API version does not expose collection sources.");
  const location = data.locations.nodes.find((node) => node.isActive);
  if (!location) throw new Error("No active Shopify inventory location was found.");
  const publication = data.publications.nodes.find((node) => node.name === "Online Store" || node.app?.title === "Online Store");
  if (!publication) throw new Error("The Online Store publication was not found.");
  return { shopName: data.shop.name, location, publication };
}

const productRows = JSON.parse(await readFile(resolve(root, "output", "shopify-product-rows.json"), "utf8"));
const collectionInputs = JSON.parse(await readFile(resolve(root, "output", "shopify-collections.json"), "utf8"));

function groupedProducts(rows) {
  const groups = new Map();
  for (const row of rows) {
    const handle = row["URL handle"];
    if (!handle) continue;
    if (!groups.has(handle)) groups.set(handle, []);
    groups.get(handle).push(row);
  }
  return groups;
}

function normalizeExternalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function productSetInput(handle, rows, locationId) {
  const productRow = rows.find((row) => row.Title);
  const variantRows = rows.filter((row) => row["Option1 value"]);
  const optionName = variantRows[0]?.["Option1 name"] === "Default Title" ? "Title" : variantRows[0]?.["Option1 name"];
  const optionValues = [...new Set(variantRows.map((row) => row["Option1 value"]))];
  const files = rows.map((row) => ({ row, url: normalizeExternalUrl(row["Product image URL"]) }))
    .filter(({ url }) => url)
    .map(({ row, url }) => ({
      originalSource: url,
      contentType: "IMAGE",
      ...(row["Image alt text"] ? { alt: row["Image alt text"] } : {}),
    }));
  const input = {
    title: productRow.Title,
    handle,
    descriptionHtml: productRow.Description || "",
    vendor: productRow.Vendor || "The Vacuum Wizard",
    productType: productRow.Type || "",
    tags: productRow.Tags ? productRow.Tags.split(/,\s*/).filter(Boolean) : [],
    status: productRow.Status.toUpperCase(),
    productOptions: [{ name: optionName, position: 1, values: optionValues.map((name) => ({ name })) }],
    variants: variantRows.map((row, index) => {
      const tracked = row["Inventory tracker"] === "shopify";
      const quantity = Number.parseInt(row["Inventory quantity"], 10);
      return {
        position: index + 1,
        optionValues: [{ optionName, name: row["Option1 value"] }],
        price: row.Price || "0.00",
        ...(row["Compare-at price"] ? { compareAtPrice: row["Compare-at price"] } : {}),
        ...(row.SKU ? { sku: row.SKU } : {}),
        ...(row.Barcode ? { barcode: row.Barcode } : {}),
        taxable: row["Charge tax"] !== "false",
        inventoryPolicy: row["Continue selling when out of stock"] === "continue" ? "CONTINUE" : "DENY",
        inventoryItem: {
          tracked,
          requiresShipping: row["Requires shipping"] !== "false",
          ...(row.SKU ? { sku: row.SKU } : {}),
        },
        ...(tracked && Number.isInteger(quantity) ? { inventoryQuantities: [{ locationId, name: "available", quantity }] } : {}),
      };
    }),
    ...(files.length ? { files } : {}),
  };
  if (productRow["SEO title"] || productRow["SEO description"]) {
    input.seo = {
      ...(productRow["SEO title"] ? { title: productRow["SEO title"] } : {}),
      ...(productRow["SEO description"] ? { description: productRow["SEO description"] } : {}),
    };
  }
  return input;
}

async function publish(id, publicationId) {
  const data = await graphql(`mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }`, { id, input: [{ publicationId }] });
  assertUserErrors(data.publishablePublish, "publishablePublish");
}

async function deleteCatalog(products, collections) {
  for (const [index, collection] of collections.entries()) {
    const data = await graphql(`mutation DeleteCollection($input: CollectionDeleteInput!) {
      collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
    }`, { input: { id: collection.id } });
    assertUserErrors(data.collectionDelete, `collectionDelete ${collection.title}`);
    console.log(`Deleted collection ${index + 1}/${collections.length}: ${collection.title}`);
  }
  for (const [index, product] of products.entries()) {
    const data = await graphql(`mutation DeleteProduct($input: ProductDeleteInput!) {
      productDelete(input: $input, synchronous: true) { deletedProductId userErrors { field message } }
    }`, { input: { id: product.id } });
    assertUserErrors(data.productDelete, `productDelete ${product.title}`);
    console.log(`Deleted product ${index + 1}/${products.length}: ${product.title}`);
  }
}

async function importProducts(groups, preflightData) {
  const imported = [];
  let index = 0;
  for (const [handle, rows] of groups) {
    index += 1;
    const input = productSetInput(handle, rows, preflightData.location.id);
    const data = await graphql(`mutation SetProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
      productSet(identifier: $identifier, input: $input, synchronous: true) {
        product { id handle title status }
        userErrors { code field message }
      }
    }`, { identifier: { handle }, input });
    assertUserErrors(data.productSet, `productSet ${handle}`);
    if (!data.productSet.product) throw new Error(`productSet returned no product for ${handle}`);
    if (data.productSet.product.status === "ACTIVE") await publish(data.productSet.product.id, preflightData.publication.id);
    imported.push(data.productSet.product);
    console.log(`Imported product ${index}/${groups.size}: ${data.productSet.product.title}`);
  }
  return imported;
}

async function importCollections(collections, publicationId) {
  const imported = [];
  for (const [index, collection] of collections.entries()) {
    const input = {
      title: collection.title,
      handle: collection.handle,
      descriptionHtml: collection.descriptionHtml || "",
      sources: [{
        source: {
          title: `WordPress category: ${collection.title}`,
          inclusion: {
            matchType: "ALL",
            conditions: [{ productTag: { relation: "TAGGED_WITH", values: [collection.membershipTag], matchType: "ANY" } }],
          },
        },
      }],
    };
    const data = await graphql(`mutation CreateCollection($collection: CollectionCreateInput!) {
      collectionCreate(collection: $collection) {
        collection { id handle title }
        userErrors { field message }
      }
    }`, { collection: input });
    assertUserErrors(data.collectionCreate, `collectionCreate ${collection.title}`);
    await publish(data.collectionCreate.collection.id, publicationId);
    imported.push(data.collectionCreate.collection);
    console.log(`Imported collection ${index + 1}/${collections.length}: ${collection.title}`);
  }
  return imported;
}

const groups = groupedProducts(productRows);

if (command === "validate") {
  let variants = 0;
  let files = 0;
  for (const [handle, rows] of groups) {
    const productRowsForHandle = rows.filter((row) => row.Title);
    if (productRowsForHandle.length !== 1) throw new Error(`${handle} has ${productRowsForHandle.length} product rows; expected 1.`);
    const input = productSetInput(handle, rows, "gid://shopify/Location/validation");
    if (!input.title || !input.handle || !input.variants.length) throw new Error(`Incomplete product payload: ${handle}`);
    variants += input.variants.length;
    files += input.files?.length || 0;
  }
  console.log(JSON.stringify({ products: groups.size, variants, files, collections: collectionInputs.length }, null, 2));
  process.exit(0);
}

config = await loadEnv(resolve(repoRoot, ".env.migration.local"));
shop = config.SHOPIFY_STORE?.replace(/^https?:\/\//, "").replace(/\/$/, "");
if (!shop?.endsWith(".myshopify.com") || !config.SHOPIFY_CLIENT_ID || !config.SHOPIFY_CLIENT_SECRET) {
  throw new Error("Complete SHOPIFY_STORE, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET in .env.migration.local.");
}
authentication = await authenticate();
endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

const preflightData = await preflight();
const existingProducts = await getAll("products", "id handle title status tags variants(first: 250) { nodes { id } } media(first: 250) { nodes { id status } }");
const existingCollections = await getAll("collections", "id handle title products(first: 250) { nodes { handle } }");

console.log(JSON.stringify({
  command,
  shop: preflightData.shopName,
  existingProducts: existingProducts.length,
  existingCollections: existingCollections.length,
  sourceProducts: groups.size,
  sourceCollections: collectionInputs.length,
  inventoryLocation: preflightData.location.name,
}, null, 2));

if (command === "audit") process.exit(0);

if (command === "verify") {
  const productsByHandle = new Map(existingProducts.map((product) => [product.handle, product]));
  const collectionsByHandle = new Map(existingCollections.map((collection) => [collection.handle, collection]));
  const missingProducts = [...groups.keys()].filter((handle) => !productsByHandle.has(handle));
  const extraProducts = existingProducts.filter((product) => !groups.has(product.handle)).map((product) => product.handle);
  const productMismatches = [];

  for (const [handle, rows] of groups) {
    const current = productsByHandle.get(handle);
    if (!current) continue;
    const productRow = rows.find((row) => row.Title);
    const expectedStatus = productRow.Status.toUpperCase();
    const expectedVariants = rows.filter((row) => row["Option1 value"]).length;
    const expectedMedia = rows.filter((row) => normalizeExternalUrl(row["Product image URL"])).length;
    if (current.status !== expectedStatus || current.variants.nodes.length !== expectedVariants || current.media.nodes.length !== expectedMedia) {
      productMismatches.push({
        handle,
        status: `${current.status}/${expectedStatus}`,
        variants: `${current.variants.nodes.length}/${expectedVariants}`,
        media: `${current.media.nodes.length}/${expectedMedia}`,
      });
    }
  }

  const missingCollections = collectionInputs.filter((collection) => !collectionsByHandle.has(collection.handle)).map((collection) => collection.handle);
  const extraCollections = existingCollections.filter((collection) => !collectionInputs.some((source) => source.handle === collection.handle)).map((collection) => collection.handle);
  const collectionMismatches = [];
  for (const collection of collectionInputs) {
    const current = collectionsByHandle.get(collection.handle);
    if (!current) continue;
    const expectedHandles = new Set([...groups].filter(([, rows]) => rows.find((row) => row.Title)?.Tags.split(/,\s*/).includes(collection.membershipTag)).map(([handle]) => handle));
    const actualHandles = new Set(current.products.nodes.map((product) => product.handle));
    const missing = [...expectedHandles].filter((handle) => !actualHandles.has(handle));
    const extra = [...actualHandles].filter((handle) => !expectedHandles.has(handle));
    if (missing.length || extra.length) collectionMismatches.push({ handle: collection.handle, missing, extra });
  }

  const failedMedia = existingProducts.flatMap((product) => product.media.nodes.filter((media) => media.status === "FAILED").map((media) => ({ handle: product.handle, mediaId: media.id })));
  const report = {
    verifiedAt: new Date().toISOString(),
    products: existingProducts.length,
    collections: existingCollections.length,
    missingProducts,
    extraProducts,
    productMismatches,
    missingCollections,
    extraCollections,
    collectionMismatches,
    failedMedia,
  };
  await mkdir(resolve(root, "reports"), { recursive: true });
  await writeFile(resolve(root, "reports", "catalog-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  const failures = missingProducts.length + extraProducts.length + productMismatches.length + missingCollections.length + extraCollections.length + collectionMismatches.length + failedMedia.length;
  if (failures) throw new Error(`Catalog verification found ${failures} mismatch groups.`);
  process.exit(0);
}

let groupsToImport = groups;
let collectionsToImport = collectionInputs;
let deletedProducts = 0;
let deletedCollections = 0;

if (command === "replace") {
  if (confirmation !== "DELETE-ALL-PRODUCTS-AND-COLLECTIONS") {
    throw new Error("Replacement requires --confirm=DELETE-ALL-PRODUCTS-AND-COLLECTIONS");
  }
  await deleteCatalog(existingProducts, existingCollections);
  deletedProducts = existingProducts.length;
  deletedCollections = existingCollections.length;
} else if (command === "resume") {
  const existingProductHandles = new Set(existingProducts.map((product) => product.handle));
  const existingCollectionHandles = new Set(existingCollections.map((collection) => collection.handle));
  groupsToImport = new Map([...groups].filter(([handle]) => !existingProductHandles.has(handle)));
  collectionsToImport = collectionInputs.filter((collection) => !existingCollectionHandles.has(collection.handle));
} else if (command === "reconcile") {
  if (confirmation !== "RECONCILE-CATALOG") throw new Error("Reconciliation requires --confirm=RECONCILE-CATALOG");
  const extraProducts = existingProducts.filter((product) => !groups.has(product.handle));
  const extraCollections = existingCollections.filter((collection) => !collectionInputs.some((source) => source.handle === collection.handle));
  if (extraProducts.length || extraCollections.length) await deleteCatalog(extraProducts, extraCollections);
  deletedProducts = extraProducts.length;
  deletedCollections = extraCollections.length;
  const remainingProductHandles = new Set(existingProducts.filter((product) => !extraProducts.includes(product)).map((product) => product.handle));
  const remainingCollectionHandles = new Set(existingCollections.filter((collection) => !extraCollections.includes(collection)).map((collection) => collection.handle));
  groupsToImport = new Map([...groups].filter(([handle]) => !remainingProductHandles.has(handle)));
  collectionsToImport = collectionInputs.filter((collection) => !remainingCollectionHandles.has(collection.handle));
} else {
  throw new Error(`Unknown command: ${command}`);
}

const importedProducts = await importProducts(groupsToImport, preflightData);
const importedCollections = await importCollections(collectionsToImport, preflightData.publication.id);
const finalProducts = await getAll("products", "id handle title");
const finalCollections = await getAll("collections", "id handle title");
const report = {
  completedAt: new Date().toISOString(),
  shop: preflightData.shopName,
  deleted: { products: deletedProducts, collections: deletedCollections },
  imported: { products: importedProducts.length, collections: importedCollections.length },
  final: { products: finalProducts.length, collections: finalCollections.length },
};
await mkdir(resolve(root, "reports"), { recursive: true });
await writeFile(resolve(root, "reports", "catalog-replacement.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
