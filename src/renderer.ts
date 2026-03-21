import { App, TFile, MarkdownRenderer, Component } from "obsidian";
import { renderBaseAsTable, resolveBaseEmbeds } from "./base-renderer";

const THEME = "#65A692";

/* ── Math extraction ──────────────────────────────────────────────────────
   Extract $$...$$ and $...$ before Obsidian processes the markdown,
   so we can hand them to KaTeX in the exported HTML.
──────────────────────────────────────────────────────────────────────── */
interface MathEntry { type: "display" | "inline"; latex: string; }

function extractMath(content: string): { processed: string; entries: MathEntry[] } {
  const entries: MathEntry[] = [];
  const codes: string[] = [];

  // Protect fenced code blocks and inline code from math extraction
  let processed = content.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    codes.push(m);
    return `\x00C${codes.length - 1}\x00`;
  });

  // Extract display math $$...$$
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    const i = entries.length;
    entries.push({ type: "display", latex: latex.trim() });
    return `\n<div class="math-d" data-mi="${i}"></div>\n`;
  });

  // Extract inline math $...$
  processed = processed.replace(/\$([^\n$]+?)\$/g, (_, latex) => {
    const i = entries.length;
    entries.push({ type: "inline", latex });
    return `<span class="math-i" data-mi="${i}"></span>`;
  });

  // Restore code blocks
  processed = processed.replace(/\x00C(\d+)\x00/g, (_, i) => codes[+i]);
  return { processed, entries };
}

/* ── Renderer ──────────────────────────────────────────────────────────── */
export async function renderNote(
  app: App,
  file: TFile,
  rawContent: string
): Promise<{ html: string; css: string }> {
  let content = rawContent.replace(/^---[\s\S]*?---\n?/, "");
  content = resolveBaseEmbeds(content);
  const { processed, entries } = extractMath(content);

  const el = document.createElement("div");
  el.className = "markdown-preview-view markdown-rendered";

  const component = new Component();
  component.load();
  await MarkdownRenderer.render(app, processed, el, file.path, component);

  // Wait for async post-processors (callout icons, etc.)
  await new Promise((r) => setTimeout(r, 300));
  component.unload();

  // Restore math content for KaTeX
  el.querySelectorAll<HTMLElement>("[data-mi]").forEach((placeholder) => {
    const idx = parseInt(placeholder.getAttribute("data-mi") ?? "0");
    const entry = entries[idx];
    if (entry) placeholder.textContent = entry.latex;
  });

  // Remove Obsidian's native copy buttons
  el.querySelectorAll(".copy-code-button").forEach((b) => b.remove());

  // Replace base embed placeholders (data-base-embed attr) with real tables
  const basePlaceholders = Array.from(el.querySelectorAll<HTMLElement>("[data-base-embed]"));
  for (const placeholder of basePlaceholders) {
    const name = placeholder.getAttribute("data-base-embed") ?? "";
    const baseFile = app.vault.getFiles().find(
      f => f.path === name || f.name === name || f.name === name.split("/").pop()
    ) as TFile | undefined;
    const temp = document.createElement("div");
    if (baseFile) {
      temp.innerHTML = await renderBaseAsTable(app, baseFile);
    } else {
      temp.innerHTML = `<p class="base-error">Base 未找到: ${name}</p>`;
    }
    placeholder.replaceWith(...Array.from(temp.childNodes));
  }

  // Fallback: replace any .internal-embed elements pointing to .base files
  // (in case MarkdownRenderer created them instead of rendering the placeholder)
  const internalEmbeds = Array.from(el.querySelectorAll<HTMLElement>(".internal-embed"));
  for (const embed of internalEmbeds) {
    const src = embed.getAttribute("src") ?? "";
    if (!src.endsWith(".base")) continue;
    const baseName = src.split("/").pop() ?? src;
    const baseFile = app.vault.getFiles().find(
      f => f.path === src || f.name === baseName
    ) as TFile | undefined;
    const temp = document.createElement("div");
    if (baseFile) {
      temp.innerHTML = await renderBaseAsTable(app, baseFile);
    } else {
      temp.innerHTML = `<p class="base-error">Base 未找到: ${src}</p>`;
    }
    embed.replaceWith(...Array.from(temp.childNodes));
  }

  // Wrap tables in .table-wrapper (skip tables already inside one)
  el.querySelectorAll("table").forEach((table) => {
    if (table.closest(".table-wrapper")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });

  return { html: el.innerHTML, css: buildCss() };
}

/* ── HTML builder ──────────────────────────────────────────────────────── */
export function buildHtml(title: string, htmlBody: string): string {
  const svgCopy = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const svgCheck = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${THEME}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  // Minimal Lucide SVG paths for common callout types
  const calloutIcons: Record<string, string> = {
    note: `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>`,
    info: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
    tip: `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
    warning: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    danger: `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
    success: `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
    question: `<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    bug: `<path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>`,
    example: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
    quote: `<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>`,
    abstract: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
    todo: `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
  };
  const calloutAliases: Record<string, string> = {
    caution: "warning", attention: "warning",
    error: "danger", failure: "danger", fail: "danger", missing: "danger",
    check: "success", done: "success",
    help: "question", faq: "question",
    hint: "tip", important: "tip",
    summary: "abstract", tldr: "abstract",
    cite: "quote",
  };

  const iconsJson = JSON.stringify(calloutIcons);
  const aliasJson = JSON.stringify(calloutAliases);

  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <button class="toc-toggle" id="toc-toggle" title="OUTLINE">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
  </button>
  <div class="toc-backdrop" id="toc-backdrop"></div>
  <nav class="toc-sidebar" id="toc-sidebar">
    <div class="toc-header">
      <span class="toc-title">OUTLINE</span>
      <button class="toc-close" id="toc-close" title="关闭">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div id="toc-inner"></div>
  </nav>
  <div class="markdown-preview-view">
${htmlBody}
  </div>

  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script>
    (function() {
      var COPY_ICON  = '${svgCopy}';
      var CHECK_ICON = '${svgCheck}';
      var ICONS   = ${iconsJson};
      var ALIASES = ${aliasJson};

      /* ── KaTeX math ── */
      document.querySelectorAll('.math-d').forEach(function(el) {
        try { katex.render(el.textContent.trim(), el, { displayMode: true,  throwOnError: false }); } catch(e) {}
      });
      document.querySelectorAll('.math-i').forEach(function(el) {
        try { katex.render(el.textContent.trim(), el, { displayMode: false, throwOnError: false }); } catch(e) {}
      });

      /* ── Callout icons ── */
      document.querySelectorAll('.callout').forEach(function(callout) {
        var iconEl = callout.querySelector('.callout-icon');
        if (!iconEl) return;
        var hasSvg = iconEl.querySelector('svg') && iconEl.querySelector('svg').childElementCount > 0;
        if (hasSvg) return;
        var type = (callout.getAttribute('data-callout') || 'note').toLowerCase();
        type = ALIASES[type] || type;
        var paths = ICONS[type] || ICONS['note'];
        iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
      });

      /* ── Callout fold/unfold ── */
      document.querySelectorAll('.callout').forEach(function(callout) {
        var hasFold = callout.hasAttribute('data-callout-fold') ||
                      callout.classList.contains('is-collapsed');
        if (!hasFold) return;
        var title   = callout.querySelector('.callout-title');
        var content = callout.querySelector('.callout-content');
        if (!title) return;

        // Clear any inline display:none Obsidian may have set — CSS handles visibility
        if (content) content.style.display = '';

        title.style.cursor = 'pointer';
        title.addEventListener('click', function() {
          callout.classList.toggle('is-collapsed');
        });
      });

      /* ── Code block: language label (via wrapper) + copy button ── */
      document.querySelectorAll('pre').forEach(function(pre) {
        var code = pre.querySelector('code');

        // Wrap pre so label can escape pre's overflow:auto clipping
        var wrapper = document.createElement('div');
        wrapper.className = 'pre-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Language label — attached to wrapper, not pre
        if (code) {
          var m = code.className.match(/language-(\S+)/);
          if (m && m[1] && m[1] !== 'undefined' && m[1] !== 'text') {
            var label = document.createElement('span');
            label.className = 'code-lang';
            label.textContent = m[1];
            wrapper.appendChild(label);
          }
        }

        // Copy button — stays inside pre (positioned relative to pre)
        var btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.title = '复制代码';
        btn.innerHTML = COPY_ICON;
        pre.appendChild(btn);
        btn.addEventListener('click', function() {
          navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(function() {
            btn.innerHTML = CHECK_ICON;
            setTimeout(function() { btn.innerHTML = COPY_ICON; }, 2000);
          });
        });
      });
    })();

    /* ── TOC generation ── */
    (function() {
      var sidebar  = document.getElementById('toc-sidebar');
      var tocInner = document.getElementById('toc-inner');
      if (!sidebar || !tocInner) return;

      var headings = Array.prototype.slice.call(
        document.querySelectorAll('.markdown-preview-view h1, .markdown-preview-view h2, .markdown-preview-view h3, .markdown-preview-view h4')
      );
      if (headings.length < 2) {
        sidebar.style.display = 'none';
        var tog = document.getElementById('toc-toggle');
        if (tog) tog.style.display = 'none';
        return;
      }

      // Ensure each heading has an id
      headings.forEach(function(h, i) {
        if (!h.id) h.id = 'toc-h-' + i;
      });

      // Build list
      var ul = document.createElement('ul');
      ul.className = 'toc-list';
      headings.forEach(function(h) {
        var li = document.createElement('li');
        li.className = 'toc-item toc-' + h.tagName.toLowerCase();
        var a = document.createElement('a');
        a.href = '#' + h.id;
        a.className = 'toc-link';
        a.textContent = h.textContent.replace(/\u00B6$/, '').trim(); // strip Obsidian ¶
        a.addEventListener('click', function(e) {
          e.preventDefault();
          document.getElementById(h.id).scrollIntoView({ behavior: 'smooth' });
        });
        li.appendChild(a);
        ul.appendChild(li);
      });
      tocInner.appendChild(ul);

      // Active link tracking
      var links = tocInner.querySelectorAll('.toc-link');
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            links.forEach(function(l) { l.classList.remove('is-active'); });
            var active = tocInner.querySelector('[href="#' + entry.target.id + '"]');
            if (active) active.classList.add('is-active');
          }
        });
      }, { rootMargin: '-8% 0px -80% 0px', threshold: 0 });
      headings.forEach(function(h) { observer.observe(h); });

      // Close drawer on link click (mobile)
      tocInner.querySelectorAll('.toc-link').forEach(function(a) {
        a.addEventListener('click', function() {
          sidebar.classList.remove('is-open');
          document.getElementById('toc-backdrop').classList.remove('is-visible');
          document.body.style.overflow = '';
        });
      });
    })();

    /* ── TOC mobile toggle ── */
    (function() {
      var toggle   = document.getElementById('toc-toggle');
      var sidebar  = document.getElementById('toc-sidebar');
      var backdrop = document.getElementById('toc-backdrop');
      var closeBtn = document.getElementById('toc-close');
      function openToc()  {
        sidebar.classList.add('is-open');
        backdrop.classList.add('is-visible');
        document.body.style.overflow = 'hidden';
      }
      function closeToc() {
        sidebar.classList.remove('is-open');
        backdrop.classList.remove('is-visible');
        document.body.style.overflow = '';
      }
      if (toggle)   toggle.addEventListener('click', openToc);
      if (backdrop) backdrop.addEventListener('click', closeToc);
      if (closeBtn) closeBtn.addEventListener('click', closeToc);
    })();
  </script>
</body>
</html>`;
}

/* ── CSS ───────────────────────────────────────────────────────────────── */
export function buildCss(): string {
  return `/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; }

/* ── Page ── */
body {
  margin: 0;
  padding: 2rem 1rem;
  background: #fff;
  font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #24292e;
}

/* ── TOC sidebar (desktop: fixed to viewport left) ── */
.toc-sidebar {
  position: fixed;
  left: 1.5rem;
  top: 2rem;
  width: 180px;
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  font-size: 13px;
  z-index: 50;
}
.toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.toc-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #aaa;
}
.toc-close { display: none; }
.toc-toggle { display: none; }
.toc-backdrop { display: none; }
.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.toc-item { margin: 0; }
.toc-link {
  display: block;
  padding: 3px 8px;
  color: #888;
  font-size: 12.5px;
  text-decoration: none;
  line-height: 1.45;
  border-left: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toc-link:hover { color: #444; text-decoration: none; }
.toc-link.is-active { color: ${THEME}; border-left-color: ${THEME}; }
.toc-h2 .toc-link { padding-left: 8px; }
.toc-h3 .toc-link { padding-left: 20px; font-size: 12px; }
.toc-h4 .toc-link { padding-left: 32px; font-size: 11.5px; color: #aaa; }

/* ── TOC hidden on narrow desktop ── */
@media (max-width: 1199px) {
  /* Sidebar becomes a slide-in drawer */
  .toc-sidebar {
    left: 0;
    top: 0;
    width: 280px;
    height: 100dvh;
    max-height: none;
    background: #fff;
    box-shadow: none;
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.28s;
    z-index: 200;
    overflow-y: auto;
    padding: 0;
  }
  .toc-sidebar.is-open { transform: translateX(0); box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15); }
  .toc-header {
    position: sticky;
    top: 0;
    background: #fff;
    padding: 1.1rem 1rem 0.8rem;
    border-bottom: 1px solid #f0f0f0;
    margin-bottom: 0;
  }
  #toc-inner { padding: 0.75rem 1rem; }
  .toc-title { font-size: 12px; color: #555; }
  .toc-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px; height: 28px;
    background: none;
    border: none;
    cursor: pointer;
    color: #aaa;
    padding: 0;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .toc-close:hover { background: #f5f5f5; color: #555; }
  /* Mobile toggle button */
  .toc-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    left: 1rem;
    bottom: 1.5rem;
    width: 44px; height: 44px;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 50%;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    z-index: 150;
    color: #555;
    padding: 0;
  }
  .toc-toggle:active { background: #f5f5f5; }
  /* Backdrop */
  .toc-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 199;
    display: none;
  }
  .toc-backdrop.is-visible { display: block; }
}

/* ── Content container ── */
.markdown-preview-view {
  max-width: 780px;
  margin: 0 auto;
  padding: 2.5rem 3rem;
}

/* ── Mobile content padding ── */
@media (max-width: 600px) {
  body { padding: 0; }
  .markdown-preview-view { padding: 1.5rem 1.25rem; }
}

/* ── Headings ── */
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.3;
  margin: 1.5em 0 0.5em;
}
h1 { font-size: 1.75em; }
h2 { font-size: 1.4em; }
h3 { font-size: 1.15em; }
h4, h5, h6 { font-size: 1em; }

/* ── Paragraph ── */
p { margin: 0.8em 0; }

/* ── Links ── */
a {
  color: ${THEME};
  font-size: 0.9rem;
  text-decoration: none;
}
a:hover { text-decoration: underline; }
a:not(.internal-link):not(.footnote-backref)[href^="http"]::after {
  content: '↗';
  font-size: 0.65em;
  margin-left: 2px;
  opacity: 0.7;
  vertical-align: super;
}

/* ── Highlight ── */
mark { background: #FCEDB5; color: inherit; border-radius: 2px; padding: 0 2px; }

/* ── Inline code ── */
:not(pre) > code {
  font-family: "SF Mono", "Fira Code", Menlo, Courier, monospace;
  font-size: 0.8em;
  color: #347698;
  background: #F3F3F3;
  padding: 0.15em 0.4em;
  border-radius: 4px;
}

/* ── Code block ── */
pre {
  position: relative;
  background: #f8f8f8;
  border: 1px solid #DADCDE;
  border-radius: 5px;
  padding: 1rem 1.2rem;
  overflow: auto;
  font-size: 13px;
  line-height: 1.5;
}
pre code {
  font-family: "SF Mono", "Fira Code", Menlo, Courier, monospace;
  background: none;
  padding: 0;
  color: inherit;
  font-size: inherit;
  border-radius: 0;
}

/* ── pre wrapper (allows label to escape overflow:auto clipping) ── */
.pre-wrapper { position: relative; }

/* ── Code language label ── */
.code-lang {
  position: absolute;
  bottom: 8px; right: 12px;
  font-size: 11px;
  font-family: "SF Mono", Menlo, Courier, monospace;
  color: #bbb;
  text-transform: lowercase;
  user-select: none;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
}
.pre-wrapper:hover .code-lang { opacity: 1; }

/* ── Copy button ── */
.copy-btn {
  position: absolute;
  top: 8px; right: 8px;
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #DADCDE;
  border-radius: 5px;
  cursor: pointer;
  color: #888;
  opacity: 0;
  transition: opacity 0.15s;
  padding: 0;
}
.pre-wrapper:hover .copy-btn { opacity: 1; }
.copy-btn:hover { background: #f0f0f0; color: #444; }

/* ── Syntax highlighting (Prism GitHub light) ── */
.token.comment, .token.prolog, .token.doctype, .token.cdata, .token.shebang { color: #6e7781; font-style: italic; font-weight: normal; }
.token.string, .token.attr-value, .token.char, .token.inserted { color: #0a3069; }
.token.punctuation, .token.operator { color: #24292f; }
.token.number, .token.boolean, .token.variable, .token.constant, .token.regex { color: #0550ae; }
.token.keyword, .token.atrule, .token.attr-name { color: #cf222e; }
.token.function, .token.class-name, .token.builtin { color: #8250df; }
.token.tag, .token.selector, .token.property { color: #116329; }
.token.deleted { color: #82071e; background: #ffebe9; }
.token.important, .token.bold { font-weight: bold; }
.token.italic { font-style: italic; }

/* ── Block math ── */
.math-d {
  display: block;
  text-align: center;
  margin: 1.2em 0;
  overflow-x: auto;
}
.math-i { display: inline; }

/* ── Blockquote ── */
blockquote {
  position: relative;
  margin: 1em 0;
  padding: 0.8rem 1rem 0.8rem 1.3rem;
  background: rgba(101, 166, 146, 0.05);
  border-radius: 6px;
  border: none;
}
blockquote::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  width: 0.3rem;
  background: ${THEME};
  border-radius: 6px 0 0 6px;
}
blockquote p { color: #81888D; font-size: 14px; margin: 0; }

/* ── Task list ── */
.contains-task-list { list-style: none; padding-left: 0.25em; }
.task-list-item { display: flex; align-items: baseline; gap: 0.5em; margin: 0.3em 0; }
.task-list-item-checkbox {
  -webkit-appearance: none;
  appearance: none;
  flex-shrink: 0;
  width: 14px; height: 14px;
  border: 1.5px solid ${THEME};
  border-radius: 3px;
  background: #fff;
  cursor: default;
  translate: 0 1px;
}
.task-list-item-checkbox:checked {
  background-color: ${THEME};
  border-color: ${THEME};
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 10 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='1,4 3.5,7 9,1' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-size: 72%;
  background-position: center;
  background-repeat: no-repeat;
}
.task-list-item.is-checked > *:not(.task-list-item-checkbox) { color: #aaa; text-decoration: line-through; }

/* ── Lists ── */
ul, ol { padding-left: 1.5em; margin: 0.8em 0; }
li { margin: 0.3em 0; }

/* ── Table ── */
.table-wrapper {
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid #DADCDE;
  margin: 1em 0;
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead { background: #F3F9F7; border-bottom: 1px solid #DADCDE; }
th, td { color: rgb(107, 107, 107); padding: 10px 13px; border-left: 1px solid #DADCDE; }
th { font-weight: 700; }
th:first-child, td:first-child { border-left: none; }
tbody tr { border-bottom: 1px solid #DADCDE; }
tbody tr:last-child { border-bottom: none; }
tbody tr:nth-child(even) { background: rgba(101, 166, 146, 0.03); }

/* ── Callout ── */
.callout {
  border-radius: 6px;
  margin: 1em 0;
  overflow: hidden;
  border-left: 4px solid ${THEME};
  background: rgba(101, 166, 146, 0.05);
}
.callout-title {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px;
  background: rgba(101, 166, 146, 0.1);
  font-weight: 600; font-size: 0.9em;
  color: ${THEME};
}
.callout-icon { display: flex; align-items: center; flex-shrink: 0; }
.callout-icon svg {
  width: 16px; height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.callout-title-inner { flex: 1; }
.callout-fold {
  margin-left: auto;
  opacity: 0.5;
  display: flex; align-items: center;
  transition: transform 0.2s ease;
}
.callout-fold svg { width: 14px; height: 14px; }
.callout.is-collapsed .callout-fold { transform: rotate(-90deg); }
.callout-content {
  padding: 10px 14px;
  font-size: 0.9rem;
  color: rgba(0, 0, 0, 0.9);
  overflow: hidden;
  max-height: 4000px;
  opacity: 1;
  transition: max-height 0.35s ease, opacity 0.25s ease, padding 0.3s ease;
}
.callout.is-collapsed .callout-content {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.callout-content > p:first-child { margin-top: 0; }
.callout-content > p:last-child { margin-bottom: 0; }

.callout[data-callout="warning"],
.callout[data-callout="caution"],
.callout[data-callout="attention"] { border-left-color: #E6AC44; background: rgba(230,172,68,0.05); }
.callout[data-callout="warning"] .callout-title,
.callout[data-callout="caution"] .callout-title,
.callout[data-callout="attention"] .callout-title { background: rgba(230,172,68,0.1); color: #E6AC44; }

.callout[data-callout="danger"],.callout[data-callout="error"],
.callout[data-callout="failure"],.callout[data-callout="fail"],
.callout[data-callout="missing"],.callout[data-callout="bug"] { border-left-color: #E06C75; background: rgba(224,108,117,0.05); }
.callout[data-callout="danger"] .callout-title,.callout[data-callout="error"] .callout-title,
.callout[data-callout="failure"] .callout-title,.callout[data-callout="fail"] .callout-title,
.callout[data-callout="missing"] .callout-title,.callout[data-callout="bug"] .callout-title { background: rgba(224,108,117,0.1); color: #E06C75; }

.callout[data-callout="info"],.callout[data-callout="abstract"],
.callout[data-callout="summary"],.callout[data-callout="tldr"],.callout[data-callout="todo"] { border-left-color: #4A90D9; background: rgba(74,144,217,0.05); }
.callout[data-callout="info"] .callout-title,.callout[data-callout="abstract"] .callout-title,
.callout[data-callout="summary"] .callout-title,.callout[data-callout="tldr"] .callout-title,
.callout[data-callout="todo"] .callout-title { background: rgba(74,144,217,0.1); color: #4A90D9; }

.callout[data-callout="example"] { border-left-color: #7B8CDE; background: rgba(123,140,222,0.05); }
.callout[data-callout="example"] .callout-title { background: rgba(123,140,222,0.1); color: #7B8CDE; }

.callout[data-callout="quote"],.callout[data-callout="cite"] { border-left-color: #999; background: rgba(153,153,153,0.05); }
.callout[data-callout="quote"] .callout-title,.callout[data-callout="cite"] .callout-title { background: rgba(153,153,153,0.1); color: #888; }

/* ── Footnote ref ── */
.footnote-ref a, sup.footnote-ref a { color: ${THEME}; font-size: 0.8em; }

/* ── Footnote content ── */
.footnotes { margin-top: 2em; padding-top: 1em; }
.footnotes > hr { display: none; }
.footnotes ol { padding-left: 1.5em; }
.footnotes li, .footnotes p { font-size: 0.75rem; color: #666; margin: 0.3em 0; }
.footnote-backref { color: #bbb !important; font-size: 0.75em; margin-left: 4px; }
.footnote-backref:hover { color: ${THEME} !important; }

/* ── HR ── */
hr { border: none; border-top: 1px dashed #DADCDE; margin: 1.5em 0; }

/* ── Image ── */
img { max-width: 100%; border-radius: 4px; }

/* ── Misc ── */
strong { font-weight: 600; }
em { font-style: italic; }

/* ── Base embed ── */
.base-empty { color: #aaa; font-size: 13px; margin: 0.8em 0; }
.base-error { color: #E06C75; font-size: 13px; margin: 0.8em 0; }
.base-link  { color: ${THEME}; text-decoration: none; font-size: inherit; }
.base-link:hover { text-decoration: underline; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; transition: background 0.3s; }
body:hover ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.4); }
::-webkit-scrollbar-track { background: transparent; }
`;
}
