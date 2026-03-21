import { App, TFile, parseYaml, CachedMetadata } from "obsidian";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface BaseConfig {
  filters?:    { and?: string[]; or?: string[] };
  formulas?:   Record<string, string>;
  properties?: Record<string, { displayName?: string }>;
  views?: Array<{
    type?:       string;
    order?:      string[];
    sort?:       Array<{ property: string; direction?: string }>;
    limit?:      number;
  }>;
}

type Stat = { mtime: number; ctime: number };

/** Eval context — passed through the expression evaluator. */
interface EvalCtx {
  file:      TFile;
  fm:        Record<string, unknown>;
  stat:      Stat;
  vaultName: string;
}

/* ── Expression parser helpers ──────────────────────────────────────────── */

/** Split comma-separated arguments respecting parentheses and string literals. */
function splitTopLevelArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0, cur = "", inStr = false, strChar = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === strChar) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true; strChar = c; cur += c;
    } else if (c === "(" || c === "[") { depth++; cur += c; }
    else if (c === ")" || c === "]")   { depth--; cur += c; }
    else if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; }
    else { cur += c; }
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/** Return index of the first top-level occurrence of `op` in `expr`, or -1. */
function findTopLevelOp(expr: string, op: string): number {
  let depth = 0, inStr = false, strChar = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) { if (c === strChar) inStr = false; }
    else if (c === '"' || c === "'") { inStr = true; strChar = c; }
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && expr.startsWith(op, i)) return i;
  }
  return -1;
}

/* ── Formula evaluator ──────────────────────────────────────────────────── */

function evalBoolExpr(expr: string, fm: Record<string, unknown>): boolean {
  const m = expr.trim().match(/^(\w+)\.isEmpty\(\)$/);
  if (m) { const v = fm[m[1]]; return v === undefined || v === null || v === ""; }
  return false;
}

/**
 * Format a date value with a moment-style format string.
 * Tokens: YYYY MM DD HH mm ss
 */
function formatDateValue(val: string | number, fmt = "YYYY-MM-DD"): string {
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Evaluate a Base formula expression.
 * Returns an HTML string — link() produces <a> tags, everything else is plain
 * text (already HTML-safe since it comes from trusted vault metadata).
 */
function evalExpr(expr: string, ctx: EvalCtx): string {
  expr = expr.trim();

  // String literal 'text' or "text"
  const strLit = expr.match(/^(['"])(.*)\1$/s);
  if (strLit) return escapeHtml(strLit[2]);

  // link(path) or link(path, display)
  // Renders as an obsidian:// deep-link pointing to the current row's file.
  const linkM = expr.match(/^link\(([\s\S]+)\)$/);
  if (linkM) {
    const args = splitTopLevelArgs(linkM[1]);
    const display = args.length >= 2
      ? evalExpr(args[1], ctx)          // already HTML-safe
      : escapeHtml(ctx.file.basename);
    const href = `obsidian://open?vault=${encodeURIComponent(ctx.vaultName)}&file=${encodeURIComponent(ctx.file.path)}`;
    return `<a href="${href}" class="base-link">${display}</a>`;
  }

  // if(cond, val1, val2)
  const ifM = expr.match(/^if\(([\s\S]+)\)$/);
  if (ifM) {
    const args = splitTopLevelArgs(ifM[1]);
    if (args.length >= 3) {
      return evalExpr(evalBoolExpr(args[0], ctx.fm) ? args[1] : args[2], ctx);
    }
  }

  // expr.format("fmt") — respect the explicit format token
  const fmtM = expr.match(/^([\s\S]+)\.format\("([^"]+)"\)$/);
  if (fmtM) {
    const inner = evalExpr(fmtM[1], ctx);
    // If inner is a timestamp string produced by file.ctime / file.mtime,
    // convert back to a number for accurate Date construction.
    const numeric = inner === String(ctx.stat.ctime) ? ctx.stat.ctime
                  : inner === String(ctx.stat.mtime) ? ctx.stat.mtime
                  : inner;
    return formatDateValue(
      typeof numeric === "number" ? numeric : String(numeric),
      fmtM[2]   // ← the actual format string, e.g. "YYYY-MM-DD"
    );
  }

  // expr.slice(n) or expr.slice(n, m)
  const sliceM = expr.match(/^([\s\S]+)\.slice\((\d+)(?:,\s*(\d+))?\)$/);
  if (sliceM) {
    const inner = evalExpr(sliceM[1], ctx);
    const start = parseInt(sliceM[2]);
    return sliceM[3] !== undefined
      ? inner.slice(start, parseInt(sliceM[3]))
      : inner.slice(start);
  }

  // String concatenation: left + right
  const plusIdx = findTopLevelOp(expr, "+");
  if (plusIdx !== -1) {
    return evalExpr(expr.slice(0, plusIdx), ctx)
         + evalExpr(expr.slice(plusIdx + 1), ctx);
  }

  // file.* properties
  if (expr === "file.basename")   return escapeHtml(ctx.file.basename);
  if (expr === "file.name")       return escapeHtml(ctx.file.name);
  if (expr === "file.path")       return escapeHtml(ctx.file.path);
  if (expr === "file.ext")        return escapeHtml(ctx.file.extension);
  if (expr === "file.ctime")      return String(ctx.stat.ctime);
  if (expr === "file.mtime")      return String(ctx.stat.mtime);
  if (expr === "file.backlinks")  return "";

  // frontmatter property
  const v = ctx.fm[expr];
  return v !== undefined && v !== null ? escapeHtml(String(v)) : "";
}

/* ── Filter evaluator ───────────────────────────────────────────────────── */

function matchesFilter(
  expr: string,
  file: TFile,
  meta: CachedMetadata | null,
): boolean {
  expr = expr.trim();

  const bodyTags  = meta?.tags?.map(t => t.tag.replace(/^#/, "")) ?? [];
  const fmTags    = meta?.frontmatter?.tags;
  const fmTagList = Array.isArray(fmTags) ? fmTags : (fmTags ? [String(fmTags)] : []);
  const allTags   = new Set([...bodyTags, ...fmTagList]);

  const containsAllM = expr.match(/^file\.tags\.containsAll\((.+)\)$/);
  if (containsAllM) {
    const req = (containsAllM[1].match(/["']([^"']+)["']/g) ?? [])
      .map(s => s.replace(/["']/g, ""));
    return req.every(t => allTags.has(t));
  }

  const containsM = expr.match(/^file\.tags\.contains\((.+)\)$/);
  if (containsM) return allTags.has(containsM[1].replace(/["']/g, ""));

  const folderM = expr.match(/^file\.folder\s*==\s*["']([^"']+)["']$/);
  if (folderM) return (file.parent?.path ?? "") === folderM[1];

  const extM = expr.match(/^file\.ext\s*==\s*["']([^"']+)["']$/);
  if (extM) return file.extension === extM[1];

  return true;
}

/* ── Column label resolution ────────────────────────────────────────────── */

/**
 * Derive the display label for a column key.
 *
 * Priority:
 *  1. `properties["note.COL"].displayName`  (Obsidian Bases convention)
 *  2. `properties["COL"].displayName`       (fallback)
 *  3. Strip well-known prefixes (`formula.`, `file.`)
 *  4. Return the key as-is
 */
function colLabel(col: string, properties: BaseConfig["properties"]): string {
  const bare = col.startsWith("formula.") ? col.slice(8)
             : col.startsWith("file.")    ? col.slice(5)
             : col;

  return properties?.["note." + bare]?.displayName
      ?? properties?.[bare]?.displayName
      ?? properties?.["note." + col]?.displayName
      ?? properties?.[col]?.displayName
      ?? bare;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/** Build an HTML table from a `.base` file by querying the vault. */
export async function renderBaseAsTable(app: App, baseFile: TFile): Promise<string> {
  const raw = await app.vault.read(baseFile);
  let config: BaseConfig;
  try { config = parseYaml(raw) as BaseConfig; }
  catch { return `<div class="base-error">无法解析 ${baseFile.name}</div>`; }

  const view       = config.views?.[0] ?? {};
  const formulas   = config.formulas   ?? {};
  const properties = config.properties;
  const vaultName  = app.vault.getName();

  // ── Filter ──
  let matched = app.vault.getMarkdownFiles().filter(f => {
    const meta    = app.metadataCache.getFileCache(f);
    const filters = config.filters;
    if (!filters)    return true;
    if (filters.and) return filters.and.every(e => matchesFilter(e, f, meta));
    if (filters.or)  return filters.or.some(e  => matchesFilter(e, f, meta));
    return true;
  });

  // ── Sort ──
  if (view.sort?.length) {
    const { property: sortProp, direction } = view.sort[0];
    const desc = direction?.toUpperCase() === "DESC";
    matched.sort((a, b) => {
      const getV = (f: TFile): string => {
        const fm  = (app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
        const s: Stat = { mtime: f.stat.mtime, ctime: f.stat.ctime };
        const ctx: EvalCtx = { file: f, fm, stat: s, vaultName };
        if (sortProp.startsWith("formula.")) {
          const key = sortProp.slice(8);
          return formulas[key] ? evalExpr(formulas[key], ctx) : "";
        }
        if (sortProp === "file.mtime") return String(f.stat.mtime);
        if (sortProp === "file.ctime") return String(f.stat.ctime);
        if (sortProp === "file.name")  return f.name;
        const v = fm[sortProp];
        return v !== undefined ? String(v) : "";
      };
      const va = getV(a), vb = getV(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return desc ? -cmp : cmp;
    });
  }

  // ── Limit ──
  if (view.limit) matched = matched.slice(0, view.limit);

  if (matched.length === 0) return `<div class="base-empty">（无匹配记录）</div>`;

  // ── Columns ──
  const order = view.order?.length
    ? view.order
    : Object.keys(formulas).map(k => `formula.${k}`);

  const thead = `<tr>${order.map(c => `<th>${colLabel(c, properties)}</th>`).join("")}</tr>`;

  const tbody = matched.map(f => {
    const fm  = (app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
    const s: Stat  = { mtime: f.stat.mtime, ctime: f.stat.ctime };
    const ctx: EvalCtx = { file: f, fm, stat: s, vaultName };

    const cells = order.map(col => {
      if (col.startsWith("formula.")) {
        const key = col.slice(8);
        return formulas[key] ? evalExpr(formulas[key], ctx) : "";
      }
      if (col === "file.mtime")     return formatDateValue(f.stat.mtime);
      if (col === "file.ctime")     return formatDateValue(f.stat.ctime);
      if (col === "file.name")      return escapeHtml(f.name);
      if (col === "file.basename")  return escapeHtml(f.basename);
      if (col === "file.backlinks") return "";
      // frontmatter / note property
      const v = fm[col];
      return v !== undefined ? escapeHtml(String(v)) : "";
    });

    return `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
  }).join("\n");

  return `<div class="table-wrapper">\n<table>\n<thead>${thead}</thead>\n<tbody>\n${tbody}\n</tbody>\n</table>\n</div>`;
}

/** Replace ![[*.base]] embeds with data-base-embed placeholder markers.
 *  The actual table is built later via DOM post-processing in renderNote. */
export function resolveBaseEmbeds(content: string): string {
  return content.replace(
    /!\[\[([^\]]+\.base)\]\]/g,
    (_, name) => `\n\n<div data-base-embed="${name}"></div>\n\n`
  );
}
