import { Notice } from "obsidian";
import type { ShareOnlineSettings } from "./settings";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OSS = require("ali-oss");

export async function uploadToOss(
	settings: ShareOnlineSettings,
	noteName: string,
	html: string,
	css: string
): Promise<void> {
	const { ossRegion, ossBucket, ossAccessKeyId, ossAccessKeySecret, ossPrefix } = settings;

	if (!ossRegion || !ossBucket || !ossAccessKeyId || !ossAccessKeySecret) {
		new Notice("请先在设置中填写 OSS 配置信息");
		return;
	}

	new Notice("正在上传到 OSS...");

	const client = new OSS({
		region: ossRegion,
		accessKeyId: ossAccessKeyId,
		accessKeySecret: ossAccessKeySecret,
		bucket: ossBucket,
		authorizationV4: true,
	});

	const prefix = ossPrefix.replace(/\/$/, "");
	const htmlKey = `${prefix}/${noteName}/index.html`;
	const cssKey = `${prefix}/${noteName}/style.css`;

	await client.put(htmlKey, new Blob([html], { type: "text/html; charset=utf-8" }));
	await client.put(cssKey, new Blob([css], { type: "text/css; charset=utf-8" }));

	const { ossDomain } = settings;
	const base = ossDomain || `https://${ossBucket}.${ossRegion}.aliyuncs.com`;
	const url = `${base}/${htmlKey}`;
	await navigator.clipboard.writeText(url);
	new Notice(`上传成功！链接已复制到剪贴板\n${url}`);
}
