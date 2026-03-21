import { App, Modal, Notice, Plugin, TFile, FuzzySuggestModal } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export default class ShareOnlinePlugin extends Plugin {
	async onload() {
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
			const desktopPath = path.join(os.homedir(), "Desktop", file.name);
			fs.writeFileSync(desktopPath, content, "utf8");
			new Notice(`已导出到桌面：${file.name}`);
		} catch (err) {
			new Notice(`导出失败：${(err as Error).message}`);
			console.error(err);
		}
	}

	onunload() {}
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
