# Vacuum Wizard content migration

This migration synchronizes the existing WooCommerce catalog taxonomy and
WordPress content into Shopify without recreating products that have already
been imported.

## Source snapshot

Run:

```powershell
node migration/fetch-wordpress.mjs
```

Generated source data is written to `migration/data/` and is excluded from Git.

The verified source package contains:

- 154 parent WooCommerce products and 8 variation rows in the complete CSV
- 21 pages, 24 custom Articles, and 8 testimonials
- 26 product categories and 36 product tags
- 638 media records plus targeted WordPress XML exports
- 39 menu items across 3 WordPress menus
- SEO title, description, and canonical snapshots for 53 content URLs
- 3 approved product reviews

Orders, customers, unapproved comments, reviewer contact details, temporary
login cookies, and WordPress admin nonces are deliberately excluded.

## Shopify access

Create a store-owned app named `Vacuum Wizard Migration` in the Shopify Dev
Dashboard, configure and release a version with these Admin API scopes, and
install it on `7xh60f-04.myshopify.com`:

```text
read_products,write_products,
read_inventory,write_inventory,read_locations,
read_content,write_content,
read_files,write_files,
read_online_store_navigation,write_online_store_navigation,
read_publications,write_publications
```

Copy `.env.migration.example` to `.env.migration.local`, then enter the Client
ID and Client Secret in the local file. `.env.migration.local` is excluded from
Git and must never be committed or sent in chat.

Delete the migration app after the final validation and redirects are complete.

## Fresh catalog replacement

Build and validate the Shopify import data:

```powershell
./migration/build-shopify-import.ps1
node migration/replace-shopify-catalog.mjs audit
```

The replacement command permanently deletes all existing Shopify products and
collections before importing the WordPress catalog. Run it only after the audit
passes:

```powershell
node migration/replace-shopify-catalog.mjs replace --confirm=DELETE-ALL-PRODUCTS-AND-COLLECTIONS
```

## Content and navigation

Import pages, Articles, testimonials, and URL redirects, then migrate the three
WordPress navigation menus to Shopify:

```powershell
node migration/replace-shopify-content.mjs audit
node migration/replace-shopify-content.mjs import
node migration/import-shopify-menus.mjs audit
node migration/import-shopify-menus.mjs import
node migration/import-shopify-menus.mjs verify
node migration/replace-shopify-catalog.mjs update-descriptions
```

The WordPress Navigation menu becomes Shopify's `main-menu`, Useful Links
becomes `useful-links`, and Footer Bottom Menu becomes `footer-bottom-menu`.
The theme uses `main-menu` in the header, `useful-links` in the footer, and
`footer-bottom-menu` in the footer terms strip by default.
