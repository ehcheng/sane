import sanitizeHtml from "sanitize-html";

/**
 * HTML sanitizer for forwarded emails.
 *
 * Uses sanitize-html with an allowlist of safe email tags, attributes,
 * and CSS properties. Strips scripts, event handlers, iframes, objects,
 * forms, SVG, base tags, and other dangerous elements.
 *
 * Also strips tracking pixels as a post-processing step.
 */

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Structure
    "p", "div", "span", "br", "hr", "center",
    // Headings
    "h1", "h2", "h3", "h4", "h5", "h6",
    // Tables
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
    // Lists
    "ul", "ol", "li",
    // Inline formatting
    "b", "strong", "i", "em", "u", "s", "strike", "del", "ins",
    "sup", "sub", "small", "big", "font", "mark",
    // Links & images
    "a", "img",
    // Block formatting
    "blockquote", "pre", "code",
    // Definition lists (sometimes in emails)
    "dl", "dt", "dd",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height", "title"],
    table: ["width", "height", "align", "border", "cellpadding", "cellspacing", "bgcolor"],
    td: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor"],
    th: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor"],
    tr: ["align", "valign", "bgcolor"],
    col: ["width", "span", "align"],
    colgroup: ["width", "span"],
    font: ["color", "face", "size"],
    div: ["align"],
    p: ["align"],
    hr: ["width", "size", "align"],
    // Allow style on everything that has it
    "*": ["style", "class", "dir"],
  },
  allowedSchemes: ["http", "https", "mailto", "cid"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
    img: ["http", "https", "cid"],
  },
  allowedStyles: {
    "*": {
      color: [/.*/],
      "background-color": [/.*/],
      "background": [/^(?!.*url).*$/i], // allow background but not url()
      "font-size": [/.*/],
      "font-family": [/.*/],
      "font-weight": [/.*/],
      "font-style": [/.*/],
      "text-align": [/.*/],
      "text-decoration": [/.*/],
      "text-transform": [/.*/],
      "line-height": [/.*/],
      "letter-spacing": [/.*/],
      "vertical-align": [/.*/],
      padding: [/.*/],
      "padding-top": [/.*/],
      "padding-right": [/.*/],
      "padding-bottom": [/.*/],
      "padding-left": [/.*/],
      margin: [/.*/],
      "margin-top": [/.*/],
      "margin-right": [/.*/],
      "margin-bottom": [/.*/],
      "margin-left": [/.*/],
      border: [/.*/],
      "border-top": [/.*/],
      "border-right": [/.*/],
      "border-bottom": [/.*/],
      "border-left": [/.*/],
      "border-color": [/.*/],
      "border-style": [/.*/],
      "border-width": [/.*/],
      "border-collapse": [/.*/],
      "border-spacing": [/.*/],
      "border-radius": [/.*/],
      width: [/.*/],
      "max-width": [/.*/],
      "min-width": [/.*/],
      height: [/.*/],
      "max-height": [/.*/],
      display: [/.*/],
      "white-space": [/.*/],
      "word-break": [/.*/],
      "word-wrap": [/.*/],
      overflow: [/.*/],
      "table-layout": [/.*/],
      "list-style-type": [/.*/],
    },
  },
  // Strip disallowed tags entirely (don't show their text content)
  disallowedTagsMode: "discard",
};

/**
 * Strip tracking pixels: <img> tags where width or height is 0 or 1.
 */
function stripTrackingPixels(html: string): string {
  return html.replace(
    /<img\b[^>]*(?:width\s*=\s*["']?[01](?:px)?["']?|height\s*=\s*["']?[01](?:px)?["']?)[^>]*\/?>/gi,
    ""
  );
}

export function sanitizeEmailHtml(html: string): string {
  const cleaned = sanitizeHtml(html, SANITIZE_OPTIONS);
  return stripTrackingPixels(cleaned);
}
