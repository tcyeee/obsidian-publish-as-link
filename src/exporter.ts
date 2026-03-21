import { App, Notice, Vault, TFile } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { renderNote, buildHtml } from "./renderer";

export interface ExportResult {
	noteName: string;
	html: string;
	css: string;
}

export async function prepareExport(app: App, vault: Vault, file: TFile): Promise<ExportResult> {
	const raw = await vault.read(file);
	const { html: htmlBody, css } = await renderNote(app, file, raw);
	const html = buildHtml(file.basename, htmlBody);
	const folderName = Date.now().toString(36);
	return { noteName: folderName, html, css };
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

	new Notice(`已导出到本地：${folderPath}`);
	return result;
}
