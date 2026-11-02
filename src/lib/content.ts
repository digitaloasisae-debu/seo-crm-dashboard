import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * n8n may send Markdown or HTML. Store sanitized HTML either way.
 * WF2 wraps articles in <div class="blog-content"> with a <style> block for brand colors, so <style> is kept;
 * scripts, event handlers and javascript: links are still removed.
 */
export function toSafeHtml(input: { html?: string | null; markdown?: string | null }): string {
  const raw = input.html?.trim() ? input.html : marked.parse(input.markdown ?? "", { async: false });
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "figure", "figcaption", "span", "style"]),
    allowVulnerableTags: true,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["style", "class", "id"],
      img: ["src", "alt", "title", "width", "height", "loading", "style", "class"],
      a: ["href", "name", "target", "rel", "style", "class"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
  });
}
