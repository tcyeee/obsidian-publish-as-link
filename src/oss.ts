import { Notice, Vault, TFile } from "obsidian";
import type { ShareOnlineSettings } from "./settings";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OSS = require("ali-oss");

function getMimeType(ext: string): string {
	const map: Record<string, string> = {
		png:  "image/png",
		jpg:  "image/jpeg",
		jpeg: "image/jpeg",
		gif:  "image/gif",
		webp: "image/webp",
		svg:  "image/svg+xml",
		bmp:  "image/bmp",
		avif: "image/avif",
	};
	return map[ext.toLowerCase()] ?? "application/octet-stream";
}

function makeClient(settings: ShareOnlineSettings) {
	const { ossRegion, ossBucket, ossAccessKeyId, ossAccessKeySecret } = settings;
	return new OSS({
		region: ossRegion,
		accessKeyId: ossAccessKeyId,
		accessKeySecret: ossAccessKeySecret,
		bucket: ossBucket,
		authorizationV4: true,
	});
}

export async function uploadToOss(
	settings: ShareOnlineSettings,
	vault: Vault,
	noteName: string,
	html: string,
	css: string,
	images: Map<string, TFile>
): Promise<string> {
	const { ossRegion, ossBucket, ossAccessKeyId, ossAccessKeySecret, ossPrefix } = settings;

	if (!ossRegion || !ossBucket || !ossAccessKeyId || !ossAccessKeySecret) {
		new Notice("请先在设置中填写 OSS 配置信息");
		return "";
	}

	new Notice("正在上传到 OSS...");

	const client = makeClient(settings);
	const prefix = ossPrefix.replace(/\/$/, "");

	// Upload HTML and CSS
	await client.put(
		`${prefix}/${noteName}/index.html`,
		new Blob([html], { type: "text/html; charset=utf-8" })
	);
	await client.put(
		`${prefix}/${noteName}/style.css`,
		new Blob([css], { type: "text/css; charset=utf-8" })
	);

	// Upload images
	for (const [exportName, imgFile] of images) {
		const data = await vault.readBinary(imgFile);
		await client.put(
			`${prefix}/${noteName}/images/${exportName}`,
			new Blob([data], { type: getMimeType(imgFile.extension) })
		);
	}

	const base = settings.ossDomain || `https://${ossBucket}.${ossRegion}.aliyuncs.com`;
	const url = `${base}/${prefix}/${noteName}/index.html`;
	new Notice(`上传成功\n${url}`);
	return url;
}

export async function deleteFromOss(
	settings: ShareOnlineSettings,
	noteName: string
): Promise<void> {
	const { ossRegion, ossBucket, ossAccessKeyId, ossAccessKeySecret, ossPrefix } = settings;

	if (!ossRegion || !ossBucket || !ossAccessKeyId || !ossAccessKeySecret) {
		new Notice("请先在设置中填写 OSS 配置信息");
		return;
	}

	const client = makeClient(settings);
	const prefix = ossPrefix.replace(/\/$/, "");
	const folderPrefix = `${prefix}/${noteName}/`;

	// List all objects under this note's folder and delete them in bulk
	try {
		const listResult = await client.list({ prefix: folderPrefix, "max-keys": 1000 });
		const keys: string[] = (listResult.objects ?? []).map((o: { name: string }) => o.name);
		if (keys.length > 0) {
			await client.deleteMulti(keys, { quiet: true });
		}
	} catch {
		// Fallback: delete known files individually
		await client.delete(`${folderPrefix}index.html`).catch(() => {});
		await client.delete(`${folderPrefix}style.css`).catch(() => {});
	}
}
