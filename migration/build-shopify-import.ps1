param(
  [string]$DataDir = (Join-Path $PSScriptRoot 'data'),
  [string]$OutputDir = (Join-Path $PSScriptRoot 'output')
)

$ErrorActionPreference = 'Stop'

function Split-List([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
  return @($Value -split ',\s*' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function To-Grams([string]$Kilograms) {
  if ([string]::IsNullOrWhiteSpace($Kilograms)) { return '0' }
  $value = 0.0
  if ([double]::TryParse($Kilograms, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
    return [string][math]::Round($value * 1000)
  }
  return '0'
}

function ConvertTo-Handle([string]$Value) {
  $decoded = [Net.WebUtility]::HtmlDecode($Value).ToLowerInvariant()
  return (($decoded -replace '[^a-z0-9]+', '-').Trim('-'))
}

function Normalize-Description([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  return (($Value -replace "`r?\\n", "`n") -replace "\\r", '')
}

function Price-Fields($Row) {
  $regular = $Row.'Regular price'
  $sale = $Row.'Sale price'
  if (-not [string]::IsNullOrWhiteSpace($sale) -and $sale -ne $regular) {
    return @{ Price = $sale; CompareAt = $regular }
  }
  return @{ Price = $(if ($regular) { $regular } else { '0.00' }); CompareAt = '' }
}

function New-ShopifyRow {
  param(
    [string]$Handle = '', [string]$Title = '', [string]$Description = '',
    [string]$Type = '', [string]$Tags = '', [string]$Published = '',
    [string]$Status = '', [string]$Sku = '', [string]$Barcode = '',
    [string]$OptionName = '', [string]$OptionValue = '', [string]$Price = '',
    [string]$CompareAt = '', [string]$ChargeTax = '', [string]$InventoryTracker = '',
    [string]$InventoryQuantity = '', [string]$InventoryPolicy = '', [string]$WeightGrams = '',
    [string]$RequiresShipping = '', [string]$ImageUrl = '', [string]$ImagePosition = '',
    [string]$ImageAlt = '', [string]$VariantImage = '', [string]$SeoTitle = '',
    [string]$SeoDescription = '', [string]$Collection = ''
  )

  return [pscustomobject][ordered]@{
    'Title' = $Title
    'URL handle' = $Handle
    'Description' = $Description
    'Vendor' = $(if ($Title) { 'The Vacuum Wizard' } else { '' })
    'Product category' = ''
    'Type' = $Type
    'Tags' = $Tags
    'Published on online store' = $Published
    'Status' = $Status
    'SKU' = $Sku
    'Barcode' = $Barcode
    'Option1 name' = $OptionName
    'Option1 value' = $OptionValue
    'Option1 LinkedTo' = ''
    'Price' = $Price
    'Compare-at price' = $CompareAt
    'Cost per item' = ''
    'Charge tax' = $ChargeTax
    'Inventory tracker' = $InventoryTracker
    'Inventory quantity' = $InventoryQuantity
    'Continue selling when out of stock' = $InventoryPolicy
    'Weight value (grams)' = $WeightGrams
    'Weight unit for display' = $(if ($WeightGrams) { 'g' } else { '' })
    'Requires shipping' = $RequiresShipping
    'Fulfillment service' = $(if ($Sku -or $OptionValue) { 'manual' } else { '' })
    'Product image URL' = $ImageUrl
    'Image position' = $ImagePosition
    'Image alt text' = $ImageAlt
    'Variant image URL' = $VariantImage
    'Gift card' = $(if ($Title) { 'false' } else { '' })
    'SEO title' = $SeoTitle
    'SEO description' = $SeoDescription
    'Collection' = $Collection
  }
}

$sourceCsv = Join-Path $DataDir 'vacuum-wizard-woocommerce-products-complete.csv'
$productsJson = Join-Path $DataDir 'products.json'
$categoriesJson = Join-Path $DataDir 'product-categories.json'
$tagsJson = Join-Path $DataDir 'product-tags.json'
$productsXml = Join-Path $DataDir 'wordpress-products.xml'

foreach ($required in @($sourceCsv, $productsJson, $categoriesJson, $tagsJson, $productsXml)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Missing source export: $required" }
}

$wooRows = Import-Csv -LiteralPath $sourceCsv
$publicProducts = Get-Content -Raw -LiteralPath $productsJson | ConvertFrom-Json
$categories = Get-Content -Raw -LiteralPath $categoriesJson | ConvertFrom-Json
$wpTags = Get-Content -Raw -LiteralPath $tagsJson | ConvertFrom-Json
[xml]$wxr = Get-Content -Raw -LiteralPath $productsXml

$slugById = @{}
foreach ($product in $publicProducts) { $slugById[[string]$product.id] = $product.slug }
foreach ($item in $wxr.rss.channel.item) {
  $postId = ($item.ChildNodes | Where-Object LocalName -eq 'post_id').InnerText
  $postType = ($item.ChildNodes | Where-Object LocalName -eq 'post_type').InnerText
  $postName = ($item.ChildNodes | Where-Object LocalName -eq 'post_name').InnerText
  if ($postType -eq 'product' -and $postId -and $postName) { $slugById[[string]$postId] = $postName }
}

$categoryByName = @{}
$categoryById = @{}
foreach ($category in $categories) {
  $categoryByName[$category.name.ToLowerInvariant()] = $category
  $categoryById[[string]$category.id] = $category
}

$tagByName = @{}
foreach ($tag in $wpTags) { $tagByName[$tag.name.ToLowerInvariant()] = $tag }

$parents = @($wooRows | Where-Object { $_.Type -in @('simple', 'variable') })
$variations = @($wooRows | Where-Object Type -eq 'variation')
$parentBySku = @{}
foreach ($parent in $parents) {
  if ($parent.SKU) { $parentBySku[$parent.SKU] = $parent }
}

$variationsByParent = @{}
foreach ($variation in $variations) {
  $parentId = if ($variation.Parent -like 'id:*') {
    $variation.Parent.Substring(3)
  } elseif ($parentBySku.ContainsKey($variation.Parent)) {
    $parentBySku[$variation.Parent].ID
  } else {
    throw "Cannot resolve variation $($variation.ID) parent '$($variation.Parent)'"
  }
  if (-not $variationsByParent.ContainsKey($parentId)) { $variationsByParent[$parentId] = @() }
  $variationsByParent[$parentId] += $variation
}

$shopifyRows = [Collections.Generic.List[object]]::new()
$audit = [Collections.Generic.List[object]]::new()

foreach ($parent in $parents) {
  $handle = $slugById[[string]$parent.ID]
  if ([string]::IsNullOrWhiteSpace($handle)) { $handle = ConvertTo-Handle $parent.Name }
  else { $handle = ConvertTo-Handle ([Uri]::UnescapeDataString($handle)) }
  if ([string]::IsNullOrWhiteSpace($handle)) { throw "No handle can be generated for product $($parent.ID)" }

  $categoryTags = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $categoryNames = [Collections.Generic.List[string]]::new()
  foreach ($path in (Split-List $parent.Categories)) {
    foreach ($name in ($path -split '\s*>\s*')) {
      $key = $name.Trim().ToLowerInvariant()
      if ($categoryByName.ContainsKey($key)) {
        $category = $categoryByName[$key]
        [void]$categoryTags.Add("wc-cat--$($category.slug)")
        if (-not $categoryNames.Contains($category.name)) { $categoryNames.Add($category.name) }
      }
    }
  }

  $allTags = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($tag in (Split-List $parent.Tags)) { [void]$allTags.Add($tag) }
  foreach ($tag in $categoryTags) { [void]$allTags.Add($tag) }

  $primaryCategory = @($categoryNames | Where-Object { $_ -notin @('Models', 'Product Group', 'Uncategorized') } | Select-Object -Last 1)[0]
  if (-not $primaryCategory) { $primaryCategory = @($categoryNames | Select-Object -Last 1)[0] }

  $published = $parent.Published -eq '1'
  $description = Normalize-Description $(if ($parent.Description) { $parent.Description } else { $parent.'Short description' })
  $images = @(Split-List $parent.Images | Select-Object -Unique)
  $imageAltByUrl = @{}
  $publicProduct = $publicProducts | Where-Object { [string]$_.id -eq [string]$parent.ID } | Select-Object -First 1
  if ($publicProduct -and $publicProduct.store) {
    foreach ($image in $publicProduct.store.images) { $imageAltByUrl[$image.src] = $image.alt }
  }

  $base = @{
    Handle = $handle
    Title = $parent.Name
    Description = $description
    Type = $primaryCategory
    Tags = (($allTags | Sort-Object) -join ', ')
    Published = $published.ToString().ToLowerInvariant()
    Status = $(if ($published) { 'active' } else { 'draft' })
    ChargeTax = ($parent.'Tax status' -eq 'taxable').ToString().ToLowerInvariant()
    RequiresShipping = 'true'
    SeoTitle = $parent.'Meta: _yoast_wpseo_title'
    SeoDescription = $parent.'Meta: _yoast_wpseo_metadesc'
    Collection = $primaryCategory
  }

  $productVariations = @($variationsByParent[[string]$parent.ID])
  if ($parent.Type -eq 'variable') {
    if ($productVariations.Count -eq 0) { throw "Variable product $($parent.ID) has no variations" }
    for ($index = 0; $index -lt $productVariations.Count; $index++) {
      $variant = $productVariations[$index]
      $price = Price-Fields $variant
      $stockTracked = -not [string]::IsNullOrWhiteSpace($variant.Stock)
      $variantImage = @(Split-List $variant.Images | Select-Object -First 1)[0]
      $args = @{
        Handle = $handle
        OptionName = $variant.'Attribute 1 name'
        OptionValue = $variant.'Attribute 1 value(s)'
        Sku = $variant.SKU
        Barcode = $variant.'GTIN, UPC, EAN, or ISBN'
        Price = $price.Price
        CompareAt = $price.CompareAt
        ChargeTax = $base.ChargeTax
        InventoryTracker = $(if ($stockTracked) { 'shopify' } else { '' })
        InventoryQuantity = $(if ($stockTracked) { $variant.Stock } else { '' })
        InventoryPolicy = $(if ($variant.'Backorders allowed?' -and $variant.'Backorders allowed?' -ne '0') { 'continue' } else { 'deny' })
        WeightGrams = To-Grams $variant.'Weight (kg)'
        RequiresShipping = 'true'
        VariantImage = $variantImage
      }
      if ($index -eq 0) {
        foreach ($key in $base.Keys) { $args[$key] = $base[$key] }
        if ($images.Count) {
          $args.ImageUrl = $images[0]
          $args.ImagePosition = '1'
          $args.ImageAlt = $imageAltByUrl[$images[0]]
        }
      }
      $shopifyRows.Add((New-ShopifyRow @args))
    }
  } else {
    $price = Price-Fields $parent
    $stockTracked = -not [string]::IsNullOrWhiteSpace($parent.Stock)
    $args = @{
      Handle = $handle
      Title = $base.Title
      Description = $base.Description
      Type = $base.Type
      Tags = $base.Tags
      Published = $base.Published
      Status = $base.Status
      Sku = $parent.SKU
      Barcode = $parent.'GTIN, UPC, EAN, or ISBN'
      OptionName = 'Default Title'
      OptionValue = 'Default Title'
      Price = $price.Price
      CompareAt = $price.CompareAt
      ChargeTax = $base.ChargeTax
      InventoryTracker = $(if ($stockTracked) { 'shopify' } else { '' })
      InventoryQuantity = $(if ($stockTracked) { $parent.Stock } else { '' })
      InventoryPolicy = $(if ($parent.'Backorders allowed?' -and $parent.'Backorders allowed?' -ne '0') { 'continue' } else { 'deny' })
      WeightGrams = To-Grams $parent.'Weight (kg)'
      RequiresShipping = $base.RequiresShipping
      SeoTitle = $base.SeoTitle
      SeoDescription = $base.SeoDescription
      Collection = $base.Collection
    }
    if ($images.Count) {
      $args.ImageUrl = $images[0]
      $args.ImagePosition = '1'
      $args.ImageAlt = $imageAltByUrl[$images[0]]
    }
    $shopifyRows.Add((New-ShopifyRow @args))
  }

  for ($imageIndex = 1; $imageIndex -lt $images.Count; $imageIndex++) {
    $shopifyRows.Add((New-ShopifyRow -Handle $handle -ImageUrl $images[$imageIndex] -ImagePosition ([string]($imageIndex + 1)) -ImageAlt $imageAltByUrl[$images[$imageIndex]]))
  }

  $audit.Add([pscustomobject]@{
    WordPressId = [int]$parent.ID
    Handle = $handle
    Title = $parent.Name
    SourceStatus = $parent.Published
    ShopifyStatus = $base.Status
    Variants = $(if ($parent.Type -eq 'variable') { $productVariations.Count } else { 1 })
    Images = $images.Count
    Categories = ($categoryNames -join ' | ')
    CollectionTags = (($categoryTags | Sort-Object) -join ', ')
  })
}

$collections = foreach ($category in $categories) {
  [pscustomobject][ordered]@{
    wordpressId = $category.id
    title = $category.name
    handle = $category.slug
    parentWordpressId = $category.parent
    descriptionHtml = Normalize-Description $category.description
    productCount = $category.count
    membershipTag = "wc-cat--$($category.slug)"
  }
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$csvPath = Join-Path $resolvedOutput 'shopify-products.csv'
$auditPath = Join-Path $resolvedOutput 'shopify-products-audit.csv'
$collectionsPath = Join-Path $resolvedOutput 'shopify-collections.json'
$rowsJsonPath = Join-Path $resolvedOutput 'shopify-product-rows.json'

$shopifyRows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding utf8
$audit | Export-Csv -LiteralPath $auditPath -NoTypeInformation -Encoding utf8
$collections | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $collectionsPath -Encoding utf8
$shopifyRows | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $rowsJsonPath -Encoding utf8

foreach ($path in @($csvPath, $auditPath, $collectionsPath, $rowsJsonPath)) {
  $content = [IO.File]::ReadAllText($path)
  [IO.File]::WriteAllText($path, ($content -replace "`r`n", "`n"), [Text.UTF8Encoding]::new($false))
}

$duplicateHandles = @($audit | Group-Object Handle | Where-Object Count -gt 1)
if ($duplicateHandles.Count) { throw "Duplicate handles generated: $($duplicateHandles.Name -join ', ')" }

[pscustomobject]@{
  ParentProducts = $parents.Count
  Variations = $variations.Count
  ShopifyRows = $shopifyRows.Count
  Collections = $collections.Count
  ActiveProducts = @($audit | Where-Object ShopifyStatus -eq 'active').Count
  DraftProducts = @($audit | Where-Object ShopifyStatus -eq 'draft').Count
  Output = $csvPath
} | Format-List
