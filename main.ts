import { Menu, Notice, Plugin, TFile } from "obsidian";
import { ShareOnlineSettings, DEFAULT_SETTINGS, ShareOnlineSettingTab } from "./src/settings";
import { exportToLocal, prepareExport } from "./src/exporter";
import { uploadToOss, deleteFromOss } from "./src/oss";

const THEME_COLOR = "#65A692";

const SVG_SHARE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

export default class ShareOnlinePlugin extends Plugin {
	settings: ShareOnlineSettings;
	private statusBarEl: HTMLElement;

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

		// ── Status bar share button ──────────────────────────────────────
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.innerHTML = SVG_SHARE;
		this.statusBarEl.style.cssText = "cursor:pointer; display:flex; align-items:center; padding:0 4px;";
		this.statusBarEl.title = "分享笔记";
		this.updateStatusBar();

		this.statusBarEl.addEventListener("click", (e) => this.showShareMenu(e));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.updateStatusBar())
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", (changedFile) => {
				const active = this.app.workspace.getActiveFile();
				if (active && changedFile.path === active.path) this.updateStatusBar();
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ── Frontmatter helpers ───────────────────────────────────────────────

	private getShareLink(file: TFile): string {
		return this.app.metadataCache.getFileCache(file)?.frontmatter?.share_link ?? "";
	}

	private async setShareLink(file: TFile, url: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.share_link = url;
		});
	}

	private async removeShareLink(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			delete fm.share_link;
		});
	}

	// ── Status bar ───────────────────────────────────────────────────────

	private updateStatusBar() {
		const file = this.app.workspace.getActiveFile();
		const published = file ? !!this.getShareLink(file) : false;
		const svg = this.statusBarEl.querySelector("svg");
		if (svg) svg.style.color = published ? THEME_COLOR : "var(--text-muted)";
		this.statusBarEl.title = published ? "已发布 — 点击管理" : "分享笔记";
	}

	private showShareMenu(event: MouseEvent) {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("没有打开的笔记");
			return;
		}

		const published = !!this.getShareLink(file);
		const menu = new Menu();

		if (!published) {
			menu.addItem((item) =>
				item
					.setTitle("发布到线上")
					.setIcon("upload-cloud")
					.onClick(() => this.publishNote(file))
			);
			menu.addItem((item) =>
				item
					.setTitle("导出到本地")
					.setIcon("download")
					.onClick(() => this.exportFile(file, false))
			);
		} else {
			menu.addItem((item) =>
				item
					.setTitle("打开链接")
					.setIcon("external-link")
					.onClick(() => {
						const url = this.getShareLink(file);
						window.open(url, "_blank");
					})
			);
			menu.addItem((item) =>
				item
					.setTitle("内容更新")
					.setIcon("refresh-cw")
					.onClick(() => this.updateNote(file))
			);
			menu.addItem((item) =>
				item
					.setTitle("停止分享")
					.setIcon("eye-off")
					.onClick(() => this.unpublishNote(file))
			);
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("导出到本地")
					.setIcon("download")
					.onClick(() => this.exportFile(file, false))
			);
		}

		menu.showAtMouseEvent(event);
	}

	// ── Actions ──────────────────────────────────────────────────────────

	private async publishNote(file: TFile) {
		const url = await this.exportFile(file, true);
		if (url) {
			await this.setShareLink(file, url);
			this.updateStatusBar();
			await navigator.clipboard.writeText(url);
			new Notice("发布成功！链接已复制到剪贴板");
		}
	}

	private async updateNote(file: TFile) {
		const existingUrl = this.getShareLink(file);
		// Extract folder name from existing URL: last segment before /index.html
		const existingName = existingUrl ? existingUrl.split("/").slice(-2, -1)[0] : undefined;
		const url = await this.exportFile(file, true, existingName);
		if (url) {
			await this.setShareLink(file, url);
			this.updateStatusBar();
			new Notice("更新成功！");
		}
	}

	private async unpublishNote(file: TFile) {
		const existingUrl = this.getShareLink(file);
		if (existingUrl) {
			const existingName = existingUrl.split("/").slice(-2, -1)[0];
			try {
				await deleteFromOss(this.settings, existingName);
			} catch (err) {
				console.error("删除 OSS 文件失败：", err);
			}
		}
		await this.removeShareLink(file);
		this.updateStatusBar();
		new Notice("已停止分享");
	}

	private async exportCurrentNote(toOss = false) {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("没有打开的笔记");
			return;
		}
		await this.exportFile(file, toOss);
	}

	private async exportFile(file: TFile, toOss = false, existingName?: string): Promise<string> {
		try {
			if (toOss) {
				const result = await prepareExport(this.app, this.app.vault, file, existingName);
				return await uploadToOss(this.settings, result.noteName, result.html, result.css);
			} else {
				await exportToLocal(
					this.app,
					this.app.vault,
					file,
					this.settings.exportPath || DEFAULT_SETTINGS.exportPath
				);
				return "";
			}
		} catch (err) {
			new Notice(`导出失败：${(err as Error).message}`);
			console.error(err);
			return "";
		}
	}

	onunload() { }
}
