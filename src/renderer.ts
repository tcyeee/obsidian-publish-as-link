import { marked } from "marked";

export async function renderNote(rawContent: string): Promise<{ html: string; css: string }> {
	const content = rawContent.replace(/^---[\s\S]*?---\n?/, "");
	const htmlBody = await marked(content);
	return { html: htmlBody, css: buildCss() };
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
  <article class="markdown-body">
${htmlBody}  </article>
</body>
</html>`;
}

export function buildCss(): string {
	return `/* Base */
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  padding: 2rem 1rem;
  background: #f6f8fa;
  color: #24292e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}

.markdown-body {
  max-width: 780px;
  margin: 0 auto;
  background: #fff;
  padding: 2.5rem 3rem;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  margin: 1.5em 0 0.5em;
  font-weight: 600;
  line-height: 1.3;
}
h1 { font-size: 2em; border-bottom: 2px solid #eaecef; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.2em; }
h3 { font-size: 1.25em; }

/* Paragraph & inline */
p { margin: 0.8em 0; }
a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }
strong { font-weight: 600; }
em { font-style: italic; }

/* Code */
code {
  background: #f0f2f4;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.9em;
}
pre {
  background: #f6f8fa;
  border: 1px solid #e1e4e8;
  border-radius: 6px;
  padding: 1rem 1.2rem;
  overflow: auto;
  line-height: 1.5;
}
pre code {
  background: none;
  padding: 0;
  font-size: 0.875em;
}

/* Blockquote */
blockquote {
  margin: 1em 0;
  padding: 0.5em 1em;
  color: #6a737d;
  border-left: 4px solid #dfe2e5;
}
blockquote p { margin: 0; }

/* Lists */
ul, ol { padding-left: 1.5em; margin: 0.8em 0; }
li { margin: 0.3em 0; }

/* Table */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.95em;
}
th, td {
  border: 1px solid #dfe2e5;
  padding: 0.5em 0.8em;
  text-align: left;
}
th { background: #f6f8fa; font-weight: 600; }
tr:nth-child(even) { background: #fafbfc; }

/* HR */
hr {
  border: none;
  border-top: 1px solid #eaecef;
  margin: 1.5em 0;
}

/* Image */
img { max-width: 100%; border-radius: 4px; }
`;
}
