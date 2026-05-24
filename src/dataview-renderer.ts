import { App, TFile, CachedMetadata } from "obsidian";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Column { expr: string; alias: string; }

interface DQLQuery {
  type:       "table" | "list" | "task";
  withoutId:  boolean;
  columns:    Column[];           // TABLE: explicit cols; LIST: optional display field
  from:       string;             // raw FROM clause (empty = all files)
  where:      string;             // raw WHERE clause (empty = no filter)
  sort:       Array<{ field: string; desc: boolean }>;
  limit:      number | undefined;
}

/* ── Tiny shared utilities ──────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(val: string | number, fmt = "YYYY-MM-DD"): string {
  let d: Date;
  if (typeof val === "number")    d = new Date(val);
  else if (/^\d{10,}$/.test(val)) d = new Date(parseInt(val));
  else                             d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM:   String(d.getMonth() + 1).padStart(2, "0"),
    DD:   String(d.getDate()).padStart(2, "0"),
    HH:   String(d.getHours()).padStart(2, "0"),
    mm:   String(d.getMinutes()).padStart(2, "0"),
    ss:   String(d.getSeconds()).padStart(2, "0"),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, t => tokens[t] ?? t);
}

/** Split `s` by `sep` at the top level (ignoring content inside parens/quotes). */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0, inStr = false, strChar = "", cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === strChar) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true; strChar = c; cur += c;
    } else if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (depth === 0 && s.slice(i).toLowerCase().startsWith(sep.toLowerCase())) {
      parts.push(cur.trim());
      cur = "";
      i += sep.length - 1;
    } else { cur += c; }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/* ── DQL Parser ─────────────────────────────────────────────────────────── */

function parseColumns(raw: string): Column[] {
  if (!raw.trim()) return [];
  return splitTopLevel(raw, ",").map(part => {
    const asM = part.match(/^([\s\S]+?)\s+AS\s+"([^"]+)"$/i)
             ?? part.match(/^([\s\S]+?)\s+AS\s+(\S+)$/i);
    return asM
      ? { expr: asM[1].trim(), alias: asM[2] }
      : { expr: part.trim(), alias: "" };
  });
}

export function parseDataviewQuery(raw: string): DQLQuery | null {
  // Merge continuation lines into the previous keyword line
  const CLAUSE = /^(TABLE|LIST|TASK|FROM|WHERE|SORT BY|SORT|LIMIT|GROUP BY|FLATTEN)\b/i;
  const lines = raw.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const segments: string[] = [];
  for (const line of lines) {
    if (CLAUSE.test(line) || segments.length === 0) segments.push(line);
    else segments[segments.length - 1] += " " + line;
  }

  let type: DQLQuery["type"] = "table";
  let withoutId = false;
  let columns: Column[] = [];
  let from = "", where = "";
  const sort: DQLQuery["sort"] = [];
  let limit: number | undefined;

  for (const seg of segments) {
    if (/^TABLE\b/i.test(seg)) {
      type = "table";
      let rest = seg.slice(5).trim();
      if (/^WITHOUT\s+ID\b/i.test(rest)) {
        withoutId = true;
        rest = rest.replace(/^WITHOUT\s+ID\s*/i, "");
      }
      columns = parseColumns(rest);

    } else if (/^LIST\b/i.test(seg)) {
      type = "list";
      const field = seg.slice(4).trim();
      if (field) columns = [{ expr: field, alias: "" }];

    } else if (/^TASK\b/i.test(seg)) {
      type = "task";

    } else if (/^FROM\b/i.test(seg)) {
      from = seg.slice(4).trim();

    } else if (/^WHERE\b/i.test(seg)) {
      where = seg.slice(5).trim();

    } else if (/^SORT(?:\s+BY)?\b/i.test(seg)) {
      const sortStr = seg.replace(/^SORT(?:\s+BY)?\s*/i, "");
      for (const part of splitTopLevel(sortStr, ",")) {
        const m = part.trim().match(/^([\s\S]+?)\s+(ASC|DESC)$/i);
        if (m) sort.push({ field: m[1].trim(), desc: m[2].toUpperCase() === "DESC" });
        else   sort.push({ field: part.trim(), desc: false });
      }

    } else if (/^LIMIT\b/i.test(seg)) {
      const n = parseInt(seg.replace(/^LIMIT\s*/i, ""));
      if (!isNaN(n)) limit = n;
    }
  }

  return { type, withoutId, columns, from, where, sort, limit };
}

/* ── FROM source filter ─────────────────────────────────────────────────── */

function getFileTags(meta: CachedMetadata | null): Set<string> {
  const bodyTags = meta?.tags?.map(t => t.tag.replace(/^#/, "").toLowerCase()) ?? [];
  const fmTags   = meta?.frontmatter?.tags;
  const fmList   = Array.isArray(fmTags) ? fmTags : (fmTags ? [String(fmTags)] : []);
  return new Set([...bodyTags, ...fmList.map((t: string) => t.toLowerCase())]);
}

function matchesSource(src: string, file: TFile, meta: CachedMetadata | null): boolean {
  src = src.trim();
  if (!src) return true;

  // OR (lowest precedence)
  const orParts = splitTopLevel(src, " OR ");
  if (orParts.length > 1) return orParts.some(p => matchesSource(p, file, meta));

  // AND
  const andParts = splitTopLevel(src, " AND ");
  if (andParts.length > 1) return andParts.every(p => matchesSource(p, file, meta));

  // NOT / negation
  if (/^NOT\s+/i.test(src)) return !matchesSource(src.slice(3).trim(), file, meta);
  if (src.startsWith("-"))  return !matchesSource(src.slice(1).trim(), file, meta);

  // #tag
  const tagM = src.match(/^#(.+)$/);
  if (tagM) return getFileTags(meta).has(tagM[1].toLowerCase());

  // "folder/path"
  const folderM = src.match(/^"([^"]+)"$/);
  if (folderM) {
    const folder = folderM[1].replace(/\/$/, "");
    return file.path.startsWith(folder + "/") || file.parent?.path === folder;
  }

  return true; // unknown source → include
}

/* ── WHERE condition evaluator ──────────────────────────────────────────── */

function getFieldRaw(expr: string, file: TFile, meta: CachedMetadata | null): unknown {
  const fm = meta?.frontmatter ?? {};
  if (expr === "file.name")     return file.name;
  if (expr === "file.basename") return file.basename;
  if (expr === "file.path")     return file.path;
  if (expr === "file.ctime")    return file.stat.ctime;
  if (expr === "file.mtime")    return file.stat.mtime;
  if (expr === "file.size")     return file.stat.size;
  if (expr === "file.ext")      return file.extension;
  return fm[expr] ?? fm[expr.toLowerCase()];
}

function evalCondition(cond: string, file: TFile, meta: CachedMetadata | null): boolean {
  cond = cond.trim();
  if (!cond) return true;

  // AND / OR (naive, no precedence — handles simple cases)
  const orParts  = splitTopLevel(cond, " OR ");
  if (orParts.length > 1)  return orParts.some(c  => evalCondition(c, file, meta));
  const andParts = splitTopLevel(cond, " AND ");
  if (andParts.length > 1) return andParts.every(c => evalCondition(c, file, meta));

  // NOT
  if (/^!\s*/.test(cond) || /^NOT\s+/i.test(cond))
    return !evalCondition(cond.replace(/^!?\s*NOT\s+/i, "").trim(), file, meta);

  // contains(tags, "#tag") or contains(file.tags, "tag")
  const containsM = cond.match(/^contains\s*\(\s*([\w.]+)\s*,\s*"([^"]+)"\s*\)$/i);
  if (containsM) {
    const val = getFieldRaw(containsM[1], file, meta);
    const target = containsM[2].replace(/^#/, "").toLowerCase();
    if (Array.isArray(val)) return val.map(String).some(v => v.toLowerCase().includes(target));
    return String(val ?? "").toLowerCase().includes(target);
  }

  // prop != null / prop != ""
  const notNullM = cond.match(/^([\w.]+)\s*!=\s*(null|"")$/i);
  if (notNullM) {
    const val = getFieldRaw(notNullM[1], file, meta);
    return val != null && val !== "";
  }

  // prop = "value" / prop = value
  const eqM = cond.match(/^([\w.]+)\s*=\s*"?([^"]*)"?$/i);
  if (eqM) {
    return String(getFieldRaw(eqM[1], file, meta) ?? "") === eqM[2];
  }

  // prop (truthy check)
  if (/^[\w.]+$/.test(cond)) {
    const val = getFieldRaw(cond, file, meta);
    return val != null && val !== "" && val !== false;
  }

  return true; // unrecognised → include
}

/* ── Field renderer ─────────────────────────────────────────────────────── */

function renderField(
  expr: string,
  file:  TFile,
  meta:  CachedMetadata | null,
  vault: string
): string {
  expr = expr.trim();
  const fm = meta?.frontmatter ?? {};

  // dateformat(field, "fmt")
  const dfM = expr.match(/^dateformat\s*\(\s*([\s\S]+?)\s*,\s*"([^"]+)"\s*\)$/i);
  if (dfM) {
    const inner = renderField(dfM[1], file, meta, vault);
    return formatDate(inner, dfM[2]);
  }

  // date(field) — just format with default
  const dateM = expr.match(/^date\s*\(\s*([\s\S]+?)\s*\)$/i);
  if (dateM) return formatDate(renderField(dateM[1], file, meta, vault));

  // file.link → obsidian:// link
  if (expr === "file.link" || expr === "this.file.link") {
    const href = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file.path)}`;
    return `<a href="${href}" class="base-link">${escapeHtml(file.basename)}</a>`;
  }

  if (expr === "file.name")     return escapeHtml(file.name);
  if (expr === "file.basename") return escapeHtml(file.basename);
  if (expr === "file.path")     return escapeHtml(file.path);
  if (expr === "file.ext")      return escapeHtml(file.extension);
  if (expr === "file.size")     return String(file.stat.size);
  if (expr === "file.ctime")    return formatDate(file.stat.ctime);
  if (expr === "file.mtime")    return formatDate(file.stat.mtime);
  if (expr === "file.tags") {
    const tags = [...getFileTags(meta)].map(t => "#" + t);
    return escapeHtml(tags.join(", "));
  }

  // frontmatter property
  const val = fm[expr] ?? fm[expr.toLowerCase()];
  if (val == null) return "";
  if (Array.isArray(val)) return escapeHtml(val.map(item => (item !== null && typeof item === "object" ? JSON.stringify(item) : String(item))).join(", "));
  const s = typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
  // Auto-format date-like strings
  if (/^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(s)) return formatDate(s);
  return escapeHtml(s);
}

/** Default column header label for a built-in field. */
function defaultLabel(expr: string): string {
  const map: Record<string, string> = {
    "file.link": "File", "file.name": "Name", "file.basename": "Name",
    "file.path": "Path", "file.ctime": "Created", "file.mtime": "Modified",
    "file.size": "Size", "file.tags": "Tags", "file.ext": "Ext",
  };
  if (map[expr]) return map[expr];
  // Capitalise frontmatter property name
  return expr.charAt(0).toUpperCase() + expr.slice(1);
}

/* ── Sort helper ────────────────────────────────────────────────────────── */

function sortFiles(
  files: TFile[],
  sortSpec: DQLQuery["sort"],
  app: App,
  vault: string
): TFile[] {
  if (!sortSpec.length) return files;
  return [...files].sort((a, b) => {
    for (const { field, desc } of sortSpec) {
      const ma = app.metadataCache.getFileCache(a);
      const mb = app.metadataCache.getFileCache(b);
      const va = renderField(field, a, ma, vault);
      const vb = renderField(field, b, mb, vault);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

/* ── HTML renderers ─────────────────────────────────────────────────────── */

function renderTable(
  files: TFile[],
  query: DQLQuery,
  app:   App,
  vault: string
): string {
  const cols: Column[] = query.withoutId
    ? query.columns
    : [{ expr: "file.link", alias: "File" }, ...query.columns];

  const headers = cols.map(c => c.alias || defaultLabel(c.expr));
  const thead = `<tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  const tbody = files.map(f => {
    const meta = app.metadataCache.getFileCache(f);
    const cells = cols.map(c => `<td>${renderField(c.expr, f, meta, vault)}</td>`);
    return `<tr>${cells.join("")}</tr>`;
  }).join("\n");

  return `<div class="table-wrapper">\n<table>\n<thead>${thead}</thead>\n<tbody>\n${tbody}\n</tbody>\n</table>\n</div>`;
}

function renderList(
  files: TFile[],
  query: DQLQuery,
  vault: string,
  app:   App
): string {
  const displayCol = query.columns[0];
  const items = files.map(f => {
    const meta = app.metadataCache.getFileCache(f);
    const link = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(f.path)}`;
    const label = displayCol
      ? renderField(displayCol.expr, f, meta, vault)
      : `<a href="${link}" class="base-link">${escapeHtml(f.basename)}</a>`;
    return `<li>${label}</li>`;
  }).join("\n");
  return `<ul class="dv-list">\n${items}\n</ul>`;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Render a DQL query string to an HTML string (table or list).
 * Returns an error div if the query cannot be parsed.
 */
export function renderDataviewQuery(
  app:         App,
  _sourceFile: TFile,
  queryText:   string
): string {
  const query = parseDataviewQuery(queryText);
  if (!query) return `<div class="base-error">无法解析 Dataview 查询</div>`;

  if (query.type === "task") {
    // Tasks need complex rendering — fall back to plain code block
    return `<pre><code class="language-dataview">${escapeHtml(queryText)}</code></pre>`;
  }

  const vault = app.vault.getName();

  // ── Filter files ──
  let files = app.vault.getMarkdownFiles().filter(f => {
    const meta = app.metadataCache.getFileCache(f);
    return matchesSource(query.from, f, meta)
        && evalCondition(query.where, f, meta);
  });

  // ── Sort ──
  files = sortFiles(files, query.sort, app, vault);

  // ── Limit ──
  if (query.limit !== undefined) files = files.slice(0, query.limit);

  if (files.length === 0) return `<div class="base-empty">（无匹配结果）</div>`;

  return query.type === "list"
    ? renderList(files, query, vault, app)
    : renderTable(files, query, vault, app);
}

/**
 * Find all `code.language-dataview` elements in the rendered DOM,
 * execute their queries, and replace the parent `<pre>` with the result.
 */
export function processDataviewBlocks(app: App, sourceFile: TFile, el: HTMLElement): void {
  const codeEls = Array.from(
    el.querySelectorAll<HTMLElement>("code.language-dataview")
  );
  for (const codeEl of codeEls) {
    const pre = codeEl.closest("pre") ?? codeEl.parentElement;
    if (!pre) continue;
    const queryText = codeEl.textContent ?? "";
    const html = renderDataviewQuery(app, sourceFile, queryText);
    const parsed = new DOMParser().parseFromString(html, "text/html");
    pre.replaceWith(...Array.from(parsed.body.childNodes));
  }
}
