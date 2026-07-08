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

## Shopify access

Create a store-owned app named `Vacuum Wizard Migration` in the Shopify Dev
Dashboard, configure and release a version with these Admin API scopes, and
install it on `7xh60f-04.myshopify.com`:

```text
read_products,write_products,
read_content,write_content,
read_files,write_files,
read_online_store_navigation,write_online_store_navigation,
read_publications,write_publications
```

Copy `.env.migration.example` to `.env.migration.local`, then enter the Client
ID and Client Secret in the local file. `.env.migration.local` is excluded from
Git and must never be committed or sent in chat.

Delete the migration app after the final validation and redirects are complete.
