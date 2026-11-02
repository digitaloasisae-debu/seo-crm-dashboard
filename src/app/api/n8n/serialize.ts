import type { Client } from "@prisma/client";

/**
 * Client profile for n8n, with the same field names the "Client Config" sheet used,
 * so existing Code nodes keep working. WordPress credentials are never included.
 */
export function clientForN8n(c: Client) {
  return {
    id: c.id,
    slug: c.slug,
    client_name: c.name,
    site_url: c.siteUrl,
    "Services Offered": c.servicesOffered.join(", "),
    "Target Audience": c.targetAudience ?? "",
    Competitors: c.competitors.join(", "),
    business_type: c.businessType ?? "",
    target_country: c.targetCountry ?? "",
    primary_city: c.primaryCity ?? "",
    service_area_cities: c.serviceAreaCities.join(", "),
    brand_voice_avoid: c.brandVoiceAvoid ?? "",
    cta_text: c.ctaText ?? "",
    "CTA Link": c.ctaLink ?? "",
    posts_per_month: c.postsPerMonth,
    posting_dates: c.preferredDates.join(", "),
    "Is image generation required?": c.imageRequired ? "Yes" : "No",
    image_style: c.imageStyle ?? "",
    reference_images: c.referenceImages,
    cms_platform: c.cmsPlatform ?? "",
    cms_preview_supported: c.cmsPreviewSupported ? "Yes" : "No",
    sitemap_or_key_pages: c.linkPool.join(", "),
    "External Links": c.socialLinks.join(", "),
    master_template_url: c.masterTemplateUrl ?? "",
    gsc_account: c.gscAccount ?? "",
    brand_primary_color: c.brandPrimaryColor ?? "",
    brand_secondary_color: c.brandSecondaryColor ?? "",
    brand_accent_color: c.brandAccentColor ?? "",
    logo_url: c.logoUrl ?? "",
  };
}
