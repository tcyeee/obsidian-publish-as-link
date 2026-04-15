import { App, Vault, TFile } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { renderNote, buildHtml } from "./renderer";

/** Collect all directly linked markdown notes from a file (no duplicates). */
export function collectLinkedNotes(app: App, file: TFile): TFile[] {
	const links = app.metadataCache.getFileCache(file)?.links ?? [];
	const seen = new Set<string>();
	const result: TFile[] = [];
	for (const link of links) {
		const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
		if (dest && dest.extension === "md" && !seen.has(dest.path)) {
			seen.add(dest.path);
			result.push(dest);
		}
	}
	return result;
}

/**
 * Rewrite internal Obsidian link hrefs in exported HTML
 * so they point to the exported sub-note pages.
 * subFolderMap: note basename / link path → subfolder name
 */
export function rewriteInternalLinks(html: string, subFolderMap: Map<string, string>): string {
	return html.replace(/<a([^>]*?)>/g, (match, attrs: string) => {
		const dataHrefMatch = attrs.match(/data-href="([^"]*)"/);
		if (!dataHrefMatch) return match;
		const dataHref = dataHrefMatch[1].split("#")[0].replace(/\.md$/i, "");
		const subFolder =
			subFolderMap.get(dataHref) ??
			subFolderMap.get(dataHref.split("/").pop() ?? "");
		if (!subFolder) {
			// Link target was not exported — point href to "#" so it stays on the page
			let newAttrs = attrs.replace(/(?<![a-zA-Z-])href="[^"]*"/, 'href="#"');
			// If there was no href attribute at all, add one
			if (!/(?<![a-zA-Z-])href="/.test(newAttrs)) {
				newAttrs += ' href="#"';
			}
			newAttrs = newAttrs.replace(/\s*target="_blank"/, "");
			return `<a${newAttrs}>`;
		}
		// Use negative lookbehind to avoid matching the `href` inside `data-href="..."`
		let newAttrs = attrs.replace(/(?<![a-zA-Z-])href="[^"]*"/, `href="./${subFolder}/index.html"`);
		// Remove target="_blank" so the link opens in the current page
		newAttrs = newAttrs.replace(/\s*target="_blank"/, "");
		return `<a${newAttrs}>`;
	});
}

export interface ExportResult {
	noteName: string;
	html: string;
	css: string;
	images: Map<string, TFile>;
}

export async function prepareExport(app: App, vault: Vault, file: TFile, existingName?: string): Promise<ExportResult> {
	const raw = await vault.read(file);
	const { html: htmlBody, css, images } = await renderNote(app, file, raw);
	const html = buildHtml(file.basename, htmlBody);
	const folderName = existingName ?? Date.now().toString(36);
	return { noteName: folderName, html, css, images };
}

export async function exportToLocal(
	app: App,
	vault: Vault,
	file: TFile,
	exportRoot: string,
	includeLinkedNotes = false
): Promise<ExportResult> {
	const result = await prepareExport(app, vault, file);

	const folderPath = path.join(exportRoot, result.noteName);
	fs.mkdirSync(folderPath, { recursive: true });

	const subFolderMap = new Map<string, string>();
	let mainHtml = result.html;

	if (includeLinkedNotes) {
		const linkedFiles = collectLinkedNotes(app, file);

		for (const linkedFile of linkedFiles) {
			const subResult = await prepareExport(app, vault, linkedFile);
			// subResult.noteName is the generated folder name (timestamp-based)
			// Map both basename and path-without-extension so the rewriter finds it
			subFolderMap.set(linkedFile.basename, subResult.noteName);
			subFolderMap.set(linkedFile.path.replace(/\.md$/i, ""), subResult.noteName);

			const subFolderPath = path.join(folderPath, subResult.noteName);
			fs.mkdirSync(subFolderPath, { recursive: true });
			fs.writeFileSync(path.join(subFolderPath, "index.html"), subResult.html, "utf8");
			fs.writeFileSync(path.join(subFolderPath, "style.css"), subResult.css, "utf8");

			if (subResult.images.size > 0) {
				const subImagesDir = path.join(subFolderPath, "images");
				fs.mkdirSync(subImagesDir, { recursive: true });
				for (const [exportName, imgFile] of subResult.images) {
					const data = await vault.readBinary(imgFile);
					fs.writeFileSync(path.join(subImagesDir, exportName), Buffer.from(data));
				}
			}
		}
	}

	// Always rewrite internal links: exported targets get proper hrefs,
	// non-exported targets have their href removed so they are not clickable.
	mainHtml = rewriteInternalLinks(mainHtml, subFolderMap);

	fs.writeFileSync(path.join(folderPath, "index.html"), mainHtml, "utf8");
	fs.writeFileSync(path.join(folderPath, "style.css"), result.css, "utf8");

	// Copy referenced images into images/ subfolder
	if (result.images.size > 0) {
		const imagesDir = path.join(folderPath, "images");
		fs.mkdirSync(imagesDir, { recursive: true });
		for (const [exportName, imgFile] of result.images) {
			const data = await vault.readBinary(imgFile);
			fs.writeFileSync(path.join(imagesDir, exportName), Buffer.from(data));
		}
	}

	return result;
}
