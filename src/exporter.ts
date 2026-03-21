import { Notice, Vault, TFile } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { renderNote, buildHtml } from "./renderer";

export interface ExportResult {
	noteName: string;
	html: string;
	css: string;
}

export async function exportToLocal(
	vault: Vault,
	file: TFile,
	exportRoot: string
): Promise<ExportResult> {
	const raw = await vault.read(file);
	const { html: htmlBody, css } = await renderNote(raw);
	const html = buildHtml(file.basename, htmlBody);

	const folderPath = path.join(exportRoot, file.basename);
	fs.mkdirSync(folderPath, { recursive: true });
	fs.writeFileSync(path.join(folderPath, "index.html"), html, "utf8");
	fs.writeFileSync(path.join(folderPath, "style.css"), css, "utf8");

	new Notice(`已导出到本地：${folderPath}`);
	return { noteName: file.basename, html, css };
}
