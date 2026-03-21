import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, FuzzySuggestModal } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface ShareOnlineSettings {
	exportPath: string;
}

const DEFAULT_SETTINGS: ShareOnlineSettings = {
	exportPath: path.join(os.homedir(), "Desktop"),
};

export default class ShareOnlinePlugin extends Plugin {
	settings: ShareOnlineSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ShareOnlineSettingTab(this.app, this));

		// 导出当前笔记到桌面
		this.addCommand({
			id: "export-current-note-to-desktop",
			name: "导出当前笔记到桌面",
			callback: () => this.exportCurrentNote(),
		});

		// 选择某个笔记导出到桌面
		this.addCommand({
			id: "export-note-to-desktop",
			name: "选择笔记导出到桌面",
			callback: () => new ExportNoteModal(this.app, this).open(),
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async exportCurrentNote() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("没有打开的笔记");
			return;
		}
		await this.exportFile(activeFile);
	}

	async exportFile(file: TFile) {
		try {
			const content = await this.app.vault.read(file);
			const exportPath = this.settings.exportPath || DEFAULT_SETTINGS.exportPath;
			const destPath = path.join(exportPath, file.name);
			fs.writeFileSync(destPath, content, "utf8");
			new Notice(`已导出到：${destPath}`);
		} catch (err) {
			new Notice(`导出失败：${(err as Error).message}`);
			console.error(err);
		}
	}

	onunload() {}
}

class ShareOnlineSettingTab extends PluginSettingTab {
	plugin: ShareOnlinePlugin;

	constructor(app: App, plugin: ShareOnlinePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("导出路径")
			.setDesc("笔记导出的目标文件夹路径，默认为桌面")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.exportPath)
					.setValue(this.plugin.settings.exportPath)
					.onChange(async (value) => {
						this.plugin.settings.exportPath = value.trim() || DEFAULT_SETTINGS.exportPath;
						await this.plugin.saveSettings();
					})
			);
	}
}

class ExportNoteModal extends FuzzySuggestModal<TFile> {
	plugin: ShareOnlinePlugin;

	constructor(app: App, plugin: ShareOnlinePlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder("输入笔记名称搜索...");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile) {
		this.plugin.exportFile(file);
	}
}
