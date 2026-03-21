import { App, TFile, MarkdownRenderer, Component } from "obsidian";

export async function renderNote(
	app: App,
	file: TFile,
	rawContent: string
): Promise<{ html: string; css: string }> {
	const content = rawContent.replace(/^---[\s\S]*?---\n?/, "");

	const el = document.createElement("div");
	el.className = "markdown-preview-view markdown-rendered";

	const component = new Component();
	component.load();
	await MarkdownRenderer.render(app, content, el, file.path, component);
	component.unload();

	// wrap each table in a .table-wrapper for outer border + border-radius
	el.querySelectorAll("table").forEach((table) => {
		const wrapper = document.createElement("div");
		wrapper.className = "table-wrapper";
		table.parentNode?.insertBefore(wrapper, table);
		wrapper.appendChild(table);
	});

	return { html: el.innerHTML, css: buildCss() };
}

export function buildHtml(title: string, htmlBody: string): string {
	return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="markdown-preview-view">
${htmlBody}
  </div>
  <script>
    document.querySelectorAll('pre').forEach(function(pre) {
      var btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      pre.appendChild(btn);
      btn.addEventListener('click', function() {
        var code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(function() {
          btn.textContent = '已复制';
          setTimeout(function() { btn.textContent = '复制'; }, 2000);
        });
      });
    });
  </script>
</body>
</html>`;
}

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

/* ── Content container ── */
.markdown-preview-view {
  max-width: 780px;
  margin: 0 auto;
  padding: 2.5rem 3rem;
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
a { color: #007AFF; text-decoration: none; }
a:hover { text-decoration: underline; }

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
.copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 10px;
  font-size: 12px;
  color: #555;
  background: #fff;
  border: 1px solid #DADCDE;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
pre:hover .copy-btn { opacity: 1; }
.copy-btn:hover { background: #f0f0f0; }
pre code {
  font-family: "SF Mono", "Fira Code", Menlo, Courier, monospace;
  background: none;
  padding: 0;
  color: inherit;
  font-size: inherit;
  border-radius: 0;
}

/* ── Blockquote ── */
blockquote {
  position: relative;
  margin: 1em 0;
  padding: 0.8rem 1rem 0.8rem 1.3rem;
  background: rgba(0, 153, 123, 0.05);
  border-radius: 6px;
  border: none;
}
blockquote::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  width: 0.3rem;
  background: #00997B;
  border-radius: 6px 0 0 6px;
}
blockquote p {
  color: #81888D;
  font-size: 14px;
  margin: 0;
}

/* ── Lists ── */
ul, ol { padding-left: 1.5em; margin: 0.8em 0; }
li { margin: 0.3em 0; }

/* ── Table ── */
.el-table, .table-wrapper {
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid #DADCDE;
  margin: 1em 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
thead { background: rgba(0, 153, 123, 0.03); font-weight: 700; }
th, td {
  color: rgb(107, 107, 107);
  padding: 10px 13px;
  border-left: 1px solid #DADCDE;
  text-align: left;
}
th:first-child, td:first-child { border-left: none; }
tbody tr { border-bottom: 1px solid #DADCDE; }
tbody tr:last-child { border-bottom: none; }
tbody tr:nth-child(even) { background: rgba(0, 153, 123, 0.03); }

/* ── HR ── */
hr { border: none; border-top: 1px dashed #DADCDE; margin: 1.5em 0; }

/* ── Image ── */
img { max-width: 100%; border-radius: 4px; }

/* ── Misc ── */
strong { font-weight: 600; }
em { font-style: italic; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; transition: background 0.3s; }
body:hover ::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.4); }
::-webkit-scrollbar-track { background: transparent; }
`;
}
