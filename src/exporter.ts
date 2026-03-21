import { App, Notice, Vault, TFile } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { renderNote, buildHtml } from "./renderer";

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
	exportRoot: string
): Promise<ExportResult> {
	const result = await prepareExport(app, vault, file);

	const folderPath = path.join(exportRoot, result.noteName);
	fs.mkdirSync(folderPath, { recursive: true });
	fs.writeFileSync(path.join(folderPath, "index.html"), result.html, "utf8");
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

	new Notice(`已导出到本地：${folderPath}`);
	return result;
}
