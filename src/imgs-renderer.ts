import { App, TFile } from "obsidian";

/* ── Image registration helper ──────────────────────────────────────────── */

/**
 * Register an image TFile into the export map.
 * Returns the de-duplicated filename that will be used under images/.
 */
export function registerImage(imgFile: TFile, images: Map<string, TFile>): string {
  for (const [name, f] of images) {
    if (f.path === imgFile.path) return name; // already registered
  }
  let name = imgFile.name;
  if (images.has(name)) {
    const ext  = imgFile.extension ? `.${imgFile.extension}` : "";
    const base = imgFile.basename;
    let i = 1;
    while (images.has(`${base}_${i}${ext}`)) i++;
    name = `${base}_${i}${ext}`;
  }
  images.set(name, imgFile);
  return name;
}

/* ── imgs block parser ───────────────────────────────────────────────────── */

interface ImgsConfig {
  border: boolean;
  shadow: boolean;
}

interface ImgsBlock {
  config: ImgsConfig;
  paths:  string[];   // vault-relative paths (leading `/` stripped)
}

/**
 * Parse the raw text of an `imgs` code block.
 *
 * Format (image-cluster plugin):
 *   - Optional first line of query parameters ending with `;;`
 *     e.g. size=90&gap=5&radius=8&shadow=false&border=true;;
 *   - Remaining lines: markdown image syntax  ![alt](/vault/path)
 *                      OR bare vault paths     /assets/foo.webp
 */
function parseImgsBlock(raw: string): ImgsBlock {
  const config: ImgsConfig = { border: false, shadow: false };
  const paths: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Config line: ends with `;;`
    if (trimmed.endsWith(";;")) {
      const params = trimmed.slice(0, -2); // strip trailing ;;
      for (const pair of params.split("&")) {
        const [key, val] = pair.split("=").map(s => s.trim().toLowerCase());
        if (key === "border") config.border = val === "true";
        if (key === "shadow") config.shadow = val === "true";
      }
      continue;
    }

    // Markdown image: ![alt](/path)  or  ![alt](path)
    const mdMatch = trimmed.match(/^!\[.*?\]\(([^)]+)\)$/);
    if (mdMatch) {
      paths.push(mdMatch[1].replace(/^\//, ""));
      continue;
    }

    // Bare path fallback: /assets/foo.webp  or  assets/foo.webp
    if (trimmed.startsWith("/") || trimmed.includes(".")) {
      paths.push(trimmed.replace(/^\//, ""));
    }
  }

  return { config, paths };
}

/* ── imgs code-block renderer ───────────────────────────────────────────── */

/**
 * Find all `code.language-imgs` blocks (image-cluster syntax), resolve each
 * image path to a vault TFile, register it in `images`, and replace the
 * `<pre><code>` with a `<div class="imgs-gallery">` of `<img>` elements
 * pointing to the exported `images/{name}` paths.
 *
 * Applies `data-border` and `data-shadow` attributes to the gallery div
 * so CSS can style thumbnails accordingly.
 */
export function processImgsBlocks(
  app: App,
  sourceFile: TFile,
  el: HTMLElement,
  images: Map<string, TFile>
): void {
  el.querySelectorAll<HTMLElement>("code.language-imgs").forEach(code => {
    const pre = code.closest("pre") ?? code.parentElement;
    if (!pre) return;

    const { config, paths } = parseImgsBlock(code.textContent ?? "");

    const gallery = createDiv({ cls: "imgs-gallery" });
    if (config.border) gallery.dataset.border = "true";
    if (config.shadow) gallery.dataset.shadow = "true";

    for (const vaultPath of paths) {
      const imgFile = (
        app.vault.getAbstractFileByPath(vaultPath) ??
        app.metadataCache.getFirstLinkpathDest(vaultPath, sourceFile.path)
      ) as TFile | null;

      const img = createEl("img");
      if (imgFile) {
        const name = registerImage(imgFile, images);
        img.setAttribute("src", `images/${name}`);
        img.setAttribute("alt", imgFile.name);
      } else {
        img.setAttribute("src", vaultPath);
        img.setAttribute("alt", vaultPath);
      }
      gallery.appendChild(img);
    }

    pre.replaceWith(gallery);
  });
}
