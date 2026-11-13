/**
 * Client-facing wording for each quick-audit issue: what the problem costs the business, and what we do about it.
 * Rule-based (one entry per issue code), so every line in the report ties to a measured finding.
 */
export type Help = { impact: string; help: string; service: "Technical SEO" | "Website speed" | "On-page SEO" | "Content" | "Local SEO" | "Tracking" };

export const AUDIT_HELP: Record<string, Help> = {
  site_unreachable: { impact: "Visitors and Google can't open the site, so it can't rank or bring in enquiries.", help: "We find out why the site is down, get it back up, and set up uptime alerts.", service: "Technical SEO" },
  no_https: { impact: "Browsers show a \"Not secure\" warning, and Google ranks secure sites first.", help: "We install an SSL certificate and redirect every page to https.", service: "Technical SEO" },
  http_no_redirect: { impact: "The same site opens on two addresses, which splits its ranking strength and can show a \"Not secure\" page.", help: "We add a permanent redirect so every visitor and Google lands on the secure https version.", service: "Technical SEO" },
  no_sitemap: { impact: "Google has to find pages on its own, so new pages get indexed slowly or not at all.", help: "We create an XML sitemap, submit it to Google Search Console and keep it updated.", service: "Technical SEO" },
  no_robots: { impact: "Search engines get no crawl instructions or sitemap location.", help: "We add a robots.txt that points Google to the sitemap and keeps private areas out of search.", service: "Technical SEO" },
  robots_blocks_all: { impact: "The site tells Google not to crawl any page, so it can't appear in search.", help: "We fix robots.txt the same day so Google can crawl the site again.", service: "Technical SEO" },
  page_error: { impact: "These pages show an error to visitors and drop out of Google.", help: "We fix or redirect every broken page so visitors and rankings aren't lost.", service: "Technical SEO" },
  noindex: { impact: "These pages are hidden from Google on purpose by a setting, so they can't rank.", help: "We check which pages should be in Google and remove the noindex setting from them.", service: "Technical SEO" },
  broken_link: { impact: "Visitors hit dead ends and Google wastes its crawl on missing pages.", help: "We repair or redirect every broken link.", service: "Technical SEO" },
  title_missing: { impact: "Google has to guess the page's headline in search results, which usually lowers clicks.", help: "We write a keyword-focused title for every page.", service: "On-page SEO" },
  title_long: { impact: "Google cuts the title off in search results, hiding part of the message.", help: "We rewrite titles to under 60 characters with the main keyword first.", service: "On-page SEO" },
  title_short: { impact: "Short titles leave out keywords people search for.", help: "We expand titles with the service, location and a reason to click.", service: "On-page SEO" },
  title_duplicate: { impact: "Several pages compete for the same search, and Google may show the wrong one.", help: "We give every page its own title aimed at its own keyword.", service: "On-page SEO" },
  meta_missing: { impact: "Google picks random text for the search snippet, which usually gets fewer clicks.", help: "We write a 150–160 character description for each page that sells the click.", service: "On-page SEO" },
  meta_long: { impact: "The description is cut off in search results.", help: "We trim descriptions to 150–160 characters with the keyword and a call to action.", service: "On-page SEO" },
  meta_duplicate: { impact: "Pages look the same in Google, so searchers can't tell which one to click.", help: "We write a unique description for each page.", service: "On-page SEO" },
  h1_missing: { impact: "The page has no main heading, which makes its topic less clear to Google and visitors.", help: "We add one clear H1 with the page's main keyword.", service: "On-page SEO" },
  h1_multiple: { impact: "Several main headings blur what the page is about.", help: "We restructure headings to one H1 followed by H2 and H3 sections.", service: "On-page SEO" },
  canonical_missing: { impact: "Copies of the same page (with tracking codes or filters) can compete with each other in Google.", help: "We add canonical tags so Google ranks the right version of each page.", service: "Technical SEO" },
  img_alt_missing: { impact: "Google can't read the images, so they don't show in image search, and screen readers skip them.", help: "We add descriptive alt text with relevant keywords to every image.", service: "On-page SEO" },
  thin_content: { impact: "Pages with little text rarely rank, because they don't answer what searchers want to know.", help: "We expand these pages with useful, keyword-researched content.", service: "Content" },
  slow_mobile: { impact: "The site loads slowly on phones, where most local searches happen, and more visitors leave before it opens.", help: "We compress images, cut heavy scripts and set up caching to speed up mobile loading.", service: "Website speed" },
  poor_lcp: { impact: "The main content takes over 4 seconds to appear on mobile, which fails Google's Core Web Vitals.", help: "We optimise the largest images and fonts and the hosting setup so the page appears within 2.5 seconds.", service: "Website speed" },
  poor_cls: { impact: "The layout jumps while loading, so visitors tap the wrong thing. This fails Google's Core Web Vitals.", help: "We reserve space for images, ads and fonts so the page stays still while it loads.", service: "Website speed" },
  no_viewport: { impact: "The site isn't set up for phones, so it shows tiny text, and Google ranks mobile-friendly sites first.", help: "We make the site mobile-friendly.", service: "Technical SEO" },
  no_analytics: { impact: "There's no Google Analytics tracking, so visits, leads and what's working can't be measured.", help: "We set up Google Analytics 4 and Tag Manager with call and form tracking, plus monthly reports.", service: "Tracking" },
  no_business_schema: { impact: "Google gets no structured details about the business (name, address, phone, hours), which helps local and rich results.", help: "We add Organization or LocalBusiness schema that matches the Google Business Profile.", service: "Local SEO" },
  no_schema: { impact: "These pages can't earn rich results such as FAQs, reviews or breadcrumbs in Google.", help: "We add the right schema (FAQ, Service, Article, Breadcrumb) to each page type.", service: "On-page SEO" },
  og_missing: { impact: "When the page is shared on Facebook, WhatsApp or LinkedIn, no preview image shows.", help: "We set share images and titles for every page.", service: "On-page SEO" },
  no_phone_link: { impact: "Mobile visitors can't tap to call from the home page.", help: "We add click-to-call buttons and track calls as leads.", service: "Local SEO" },
};

export function helpFor(code: string): Help | null {
  return AUDIT_HELP[code] ?? null;
}
