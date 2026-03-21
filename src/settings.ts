import { App, PluginSettingTab, Setting } from "obsidian";
import * as path from "path";
import * as os from "os";
import type ShareOnlinePlugin from "../main";

export interface ShareOnlineSettings {
	exportPath: string;
	ossRegion: string;
	ossBucket: string;
	ossAccessKeyId: string;
	ossAccessKeySecret: string;
	ossPrefix: string;
	ossDomain: string;
}

export const DEFAULT_SETTINGS: ShareOnlineSettings = {
	exportPath: path.join(os.homedir(), "Desktop"),
	ossRegion: "",
	ossBucket: "",
	ossAccessKeyId: "",
	ossAccessKeySecret: "",
	ossPrefix: "notes",
	ossDomain: "",
};

export class ShareOnlineSettingTab extends PluginSettingTab {
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

		new Setting(containerEl)
			.setName("自定义域名")
			.setDesc("替换默认的 OSS 域名，留空则使用默认。例如 https://cdn.example.com")
			.addText((text) =>
				text
					.setPlaceholder("https://cdn.example.com")
					.setValue(this.plugin.settings.ossDomain)
					.onChange(async (value) => {
						this.plugin.settings.ossDomain = value.trim().replace(/\/$/, "");
						await this.plugin.saveSettings();
					})
			);
	}
}
