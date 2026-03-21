import { Notice, Plugin, TFile } from "obsidian";
import { ShareOnlineSettings, DEFAULT_SETTINGS, ShareOnlineSettingTab } from "./src/settings";
import { exportToLocal } from "./src/exporter";
import { uploadToOss } from "./src/oss";

export default class ShareOnlinePlugin extends Plugin {
	settings: ShareOnlineSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ShareOnlineSettingTab(this.app, this));

		this.addCommand({
			id: "export-current-note-to-desktop",
			name: "导出到本地",
			callback: () => this.exportCurrentNote(),
		});

		this.addCommand({
			id: "export-current-note-to-oss",
			name: "导出到 OSS",
			callback: () => this.exportCurrentNote(true),
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async exportCurrentNote(toOss = false) {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("没有打开的笔记");
			return;
		}
		await this.exportFile(file, toOss);
	}

	private async exportFile(file: TFile, toOss = false) {
		try {
			const result = await exportToLocal(
				this.app.vault,
				file,
				this.settings.exportPath || DEFAULT_SETTINGS.exportPath
			);
			if (toOss) {
				await uploadToOss(this.settings, result.noteName, result.html, result.css);
			}
		} catch (err) {
			new Notice(`导出失败：${(err as Error).message}`);
			console.error(err);
		}
	}

	onunload() {}
}
