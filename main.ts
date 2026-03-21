import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, FuzzySuggestModal } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { marked } from "marked";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OSS = require("ali-oss");

interface ShareOnlineSettings {
	exportPath: string;
	ossRegion: string;
	ossBucket: string;
	ossAccessKeyId: string;
	ossAccessKeySecret: string;
	ossPrefix: string;
}

const DEFAULT_SETTINGS: ShareOnlineSettings = {
	exportPath: path.join(os.homedir(), "Desktop"),
	ossRegion: "",
	ossBucket: "",
	ossAccessKeyId: "",
	ossAccessKeySecret: "",
	ossPrefix: "notes",
};

export default class ShareOnlinePlugin extends Plugin {
	settings: ShareOnlineSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ShareOnlineSettingTab(this.app, this));

		this.addCommand({
			id: "export-current-note-to-desktop",
			name: "导出当前笔记到本地",
			callback: () => this.exportCurrentNote(),
		});

		this.addCommand({
			id: "export-note-to-desktop",
			name: "选择笔记导出到本地",
			callback: () => new ExportNoteModal(this.app, this).open(),
		});

		this.addCommand({
			id: "export-current-note-to-oss",
			name: "导出当前笔记并上传到 OSS",
			callback: () => this.exportCurrentNote(true),
		});

		this.addCommand({
			id: "export-note-to-oss",
			name: "选择笔记导出并上传到 OSS",
			callback: () => new ExportNoteModal(this.app, this, true).open(),
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async exportCurrentNote(uploadToOss = false) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("没有打开的笔记");
			return;
		}
		await this.exportFile(activeFile, uploadToOss);
	}

	buildHtml(title: string, htmlBody: string): string {
		return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <article class="markdown-body">
${htmlBody}  </article>
</body>
</html>`;
	}

	buildCss(): string {
		return `/* Base */
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  padding: 2rem 1rem;
  background: #f6f8fa;
  color: #24292e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}

.markdown-body {
  max-width: 780px;
  margin: 0 auto;
  background: #fff;
  padding: 2.5rem 3rem;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  margin: 1.5em 0 0.5em;
  font-weight: 600;
  line-height: 1.3;
}
h1 { font-size: 2em; border-bottom: 2px solid #eaecef; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.2em; }
h3 { font-size: 1.25em; }

/* Paragraph & inline */
p { margin: 0.8em 0; }
a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }
strong { font-weight: 600; }
em { font-style: italic; }

/* Code */
code {
  background: #f0f2f4;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.9em;
}
pre {
  background: #f6f8fa;
  border: 1px solid #e1e4e8;
  border-radius: 6px;
  padding: 1rem 1.2rem;
  overflow: auto;
  line-height: 1.5;
}
pre code {
  background: none;
  padding: 0;
  font-size: 0.875em;
}

/* Blockquote */
blockquote {
  margin: 1em 0;
  padding: 0.5em 1em;
  color: #6a737d;
  border-left: 4px solid #dfe2e5;
}
blockquote p { margin: 0; }

/* Lists */
ul, ol { padding-left: 1.5em; margin: 0.8em 0; }
li { margin: 0.3em 0; }

/* Table */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.95em;
}
th, td {
  border: 1px solid #dfe2e5;
  padding: 0.5em 0.8em;
  text-align: left;
}
th { background: #f6f8fa; font-weight: 600; }
tr:nth-child(even) { background: #fafbfc; }

/* HR */
hr {
  border: none;
  border-top: 1px solid #eaecef;
  margin: 1.5em 0;
}

/* Image */
img { max-width: 100%; border-radius: 4px; }
`;
	}

	async exportFile(file: TFile, uploadToOss = false) {
		try {
			const raw = await this.app.vault.read(file);
			const content = raw.replace(/^---[\s\S]*?---\n?/, "");
			const htmlBody = await marked(content);
			const html = this.buildHtml(file.basename, htmlBody);
			const css = this.buildCss();

			// 写入本地
			const exportRoot = this.settings.exportPath || DEFAULT_SETTINGS.exportPath;
			const folderPath = path.join(exportRoot, file.basename);
			fs.mkdirSync(folderPath, { recursive: true });
			const htmlPath = path.join(folderPath, "index.html");
			const cssPath = path.join(folderPath, "style.css");
			fs.writeFileSync(htmlPath, html, "utf8");
			fs.writeFileSync(cssPath, css, "utf8");
			new Notice(`已导出到本地：${folderPath}`);

			if (uploadToOss) {
				await this.uploadToOss(file.basename, htmlPath, cssPath);
			}
		} catch (err) {
			new Notice(`导出失败：${(err as Error).message}`);
			console.error(err);
		}
	}

	async uploadToOss(noteName: string, htmlPath: string, cssPath: string) {
		const { ossRegion, ossBucket, ossAccessKeyId, ossAccessKeySecret, ossPrefix } = this.settings;

		if (!ossRegion || !ossBucket || !ossAccessKeyId || !ossAccessKeySecret) {
			new Notice("请先在设置中填写 OSS 配置信息");
			return;
		}

		new Notice("正在上传到 OSS...");

		try {
			const client = new OSS({
				region: ossRegion,
				accessKeyId: ossAccessKeyId,
				accessKeySecret: ossAccessKeySecret,
				bucket: ossBucket,
			});

			const prefix = ossPrefix.replace(/\/$/, "");
			const htmlKey = `${prefix}/${noteName}/index.html`;
			const cssKey = `${prefix}/${noteName}/style.css`;

			await client.put(htmlKey, htmlPath, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
			await client.put(cssKey, cssPath, {
				headers: { "Content-Type": "text/css; charset=utf-8" },
			});

			const url = `https://${ossBucket}.${ossRegion}.aliyuncs.com/${htmlKey}`;
			await navigator.clipboard.writeText(url);
			new Notice(`上传成功！链接已复制到剪贴板\n${url}`);
		} catch (err) {
			new Notice(`OSS 上传失败：${(err as Error).message}`);
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

		// ── 本地导出 ──────────────────────────────
		containerEl.createEl("h3", { text: "本地导出" });

		new Setting(containerEl)
			.setName("导出路径")
			.setDesc("笔记导出的目标文件夹，默认为桌面")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.exportPath)
					.setValue(this.plugin.settings.exportPath)
					.onChange(async (value) => {
						this.plugin.settings.exportPath = value.trim() || DEFAULT_SETTINGS.exportPath;
						await this.plugin.saveSettings();
					})
			);

		// ── 阿里云 OSS ────────────────────────────
		containerEl.createEl("h3", { text: "阿里云 OSS" });

		new Setting(containerEl)
			.setName("Region")
			.setDesc("例如 oss-cn-hangzhou")
			.addText((text) =>
				text
					.setPlaceholder("oss-cn-hangzhou")
					.setValue(this.plugin.settings.ossRegion)
					.onChange(async (value) => {
						this.plugin.settings.ossRegion = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Bucket")
			.addText((text) =>
				text
					.setPlaceholder("my-bucket")
					.setValue(this.plugin.settings.ossBucket)
					.onChange(async (value) => {
						this.plugin.settings.ossBucket = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Access Key ID")
			.addText((text) => {
				text
					.setPlaceholder("AccessKey ID")
					.setValue(this.plugin.settings.ossAccessKeyId)
					.onChange(async (value) => {
						this.plugin.settings.ossAccessKeyId = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("Access Key Secret")
			.addText((text) => {
				text
					.setPlaceholder("AccessKey Secret")
					.setValue(this.plugin.settings.ossAccessKeySecret)
					.onChange(async (value) => {
						this.plugin.settings.ossAccessKeySecret = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("上传前缀路径")
			.setDesc("OSS 中的目录前缀，例如 notes → notes/<笔记名>/index.html")
			.addText((text) =>
				text
					.setPlaceholder("notes")
					.setValue(this.plugin.settings.ossPrefix)
					.onChange(async (value) => {
						this.plugin.settings.ossPrefix = value.trim() || DEFAULT_SETTINGS.ossPrefix;
						await this.plugin.saveSettings();
					})
			);
	}
}

class ExportNoteModal extends FuzzySuggestModal<TFile> {
	plugin: ShareOnlinePlugin;
	uploadToOss: boolean;

	constructor(app: App, plugin: ShareOnlinePlugin, uploadToOss = false) {
		super(app);
		this.plugin = plugin;
		this.uploadToOss = uploadToOss;
		this.setPlaceholder("输入笔记名称搜索...");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile) {
		this.plugin.exportFile(file, this.uploadToOss);
	}
}
