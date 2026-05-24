import { Menu, Notice, Plugin, TFile, setIcon } from "obsidian";
import { ShareOnlineSettings, DEFAULT_SETTINGS, ShareOnlineSettingTab } from "./src/settings";
import { exportToLocal, prepareExport, collectLinkedNotes, rewriteInternalLinks } from "./src/exporter";
import { uploadToOss, uploadSubNoteToOss, deleteFromOss } from "./src/oss";

/* ── Export Toast ──────────────────────────────────────────────────────── */

class ExportToast {
	private el: HTMLElement;
	private state: "loading" | "done" = "loading";
	private timer = 0;

	constructor(loadingText = "上传中...") {
		this.el = createDiv({ cls: "opal-toast" });
		this.el.createDiv({ cls: "opal-spinner" });
		this.el.createSpan({ text: loadingText });
		activeDocument.body.appendChild(this.el);
		requestAnimationFrame(() => this.el.classList.add("is-visible"));
	}

	setSuccess(text = "上传成功") {
		if (this.state === "done") return;
		this.state = "done";
		clearTimeout(this.timer);
		this.el.empty();
		const iconEl = this.el.createDiv();
		setIcon(iconEl, "check");
		this.el.createSpan({ text });
		this.timer = activeWindow.setTimeout(() => this.dismiss(), 2800);
	}

	setError(text: string) {
		if (this.state === "done") return;
		this.state = "done";
		clearTimeout(this.timer);
		this.el.empty();
		const iconEl = this.el.createDiv();
		setIcon(iconEl, "x");
		this.el.createSpan({ text });
		this.timer = activeWindow.setTimeout(() => this.dismiss(), 4000);
	}

	dismiss() {
		clearTimeout(this.timer);
		this.el.classList.remove("is-visible");
		activeWindow.setTimeout(() => this.el.remove(), 250);
	}
}

export default class ShareOnlinePlugin extends Plugin {
	settings: ShareOnlineSettings;
	private statusBarEl: HTMLElement;
	private currentToast: ExportToast | null = null;

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
		this.statusBarEl.addClass("opal-status-bar-btn");
		this.statusBarEl.title = "分享笔记";
		setIcon(this.statusBarEl, "share-2");
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<ShareOnlineSettings>);
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
		this.statusBarEl.toggleClass("opal-status-published", published);
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
					.onClick(async () => {
						await this.exportFile(file, false);
						this.currentToast?.setSuccess("导出成功");
					})
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
					.onClick(async () => {
						await this.exportFile(file, false);
						this.currentToast?.setSuccess("导出成功");
					})
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
			this.currentToast?.setSuccess("发布成功，链接已复制到剪贴板");
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
			this.currentToast?.setSuccess("更新成功");
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
		this.currentToast?.setSuccess(toOss ? "上传成功" : "导出成功");
	}

	private async exportFile(file: TFile, toOss = false, existingName?: string): Promise<string> {
		this.currentToast?.dismiss();
		this.currentToast = new ExportToast(toOss ? "上传中..." : "导出中...");
		try {
			if (toOss) {
				const result = await prepareExport(this.app, this.app.vault, file, existingName);
				const subFolderMap = new Map<string, string>();
				let mainHtml = result.html;

				if (this.settings.includeLinkedNotes) {
					const linkedFiles = collectLinkedNotes(this.app, file);

					for (const linkedFile of linkedFiles) {
						const subResult = await prepareExport(this.app, this.app.vault, linkedFile);
						// subResult.noteName is the generated folder name; map basename/path to it
						subFolderMap.set(linkedFile.basename, subResult.noteName);
						subFolderMap.set(linkedFile.path.replace(/\.md$/i, ""), subResult.noteName);
						await uploadSubNoteToOss(
							this.settings,
							this.app.vault,
							result.noteName,
							subResult.noteName,
							subResult.html,
							subResult.css,
							subResult.images
						);
					}
				}

				// Always rewrite internal links: exported targets get proper hrefs,
				// non-exported targets have their href removed so they are not clickable.
				mainHtml = rewriteInternalLinks(mainHtml, subFolderMap);

				return await uploadToOss(this.settings, this.app.vault, result.noteName, mainHtml, result.css, result.images);
			} else {
				await exportToLocal(
					this.app,
					this.app.vault,
					file,
					this.settings.exportPath || DEFAULT_SETTINGS.exportPath,
					this.settings.includeLinkedNotes
				);
				return "";
			}
		} catch (err) {
			this.currentToast?.setError(`导出失败：${(err as Error).message}`);
			console.error(err);
			return "";
		}
	}

	onunload() {
		this.currentToast?.dismiss();
	}
}
