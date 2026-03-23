# Publish as Link

An [Obsidian](https://obsidian.md) plugin that publishes your notes to Alibaba Cloud OSS and shares them as a link with one click — or exports them as polished, standalone web pages locally.

## Features

- **One-click publishing** to Alibaba Cloud OSS with a shareable link copied to clipboard
- **Local HTML export** — generates a self-contained folder (HTML + CSS + images) you can open in any browser
- **Linked notes** — optionally include all internally linked notes, with working navigation between them
- **Rich content rendering**:
  - Math expressions via KaTeX (`$ ... $` and `$$ ... $$`)
  - Code blocks with syntax highlighting and one-click copy button
  - Callouts with fold/unfold support
  - Responsive tables
  - Image galleries with lightbox (supports the [Image Cluster](https://github.com/musSpeaking/obsidian-image-layouts) `imgs` block format)
  - [Dataview](https://github.com/blacksmithgu/obsidian-dataview) DQL queries rendered as HTML tables/lists
  - [Obsidian Bases](https://obsidian.md/bases) rendered as table or card layouts
- **Auto-generated Table of Contents** sidebar (h1–h4), with scroll tracking and mobile drawer support
- **Status bar indicator** — share icon turns green when the current note is published

## Installation

> Currently not listed in the Obsidian community plugins registry. Install manually:

1. Download the latest release files (`main.js`, `manifest.json`, `styles.css`) from the [Releases](../../releases) page.
2. Copy them to your vault's plugin folder: `<vault>/.obsidian/plugins/publish-as-link/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

## Usage

### Export to Local

Run the command **"Export to Desktop"** (or the configured export path) from the command palette. A folder is created at the export destination:

```
note-name-timestamp/
├── index.html
├── style.css
└── images/
    └── ...
```

Open `index.html` in any browser.

### Publish Online

1. Configure your OSS credentials in the plugin settings (see [Configuration](#configuration)).
2. Click the share icon in the status bar, then choose **Publish** (or use the command palette).
3. The shareable URL is copied to your clipboard automatically.

Once published, clicking the status bar icon gives you:

| Action          | Description                                 |
| --------------- | ------------------------------------------- |
| Open Link       | Open the published page in your browser     |
| Update Content  | Re-upload after edits (link stays the same) |
| Stop Sharing    | Delete from cloud; link becomes invalid     |
| Export to Local | Save a local copy                           |

## Configuration

Open **Settings → Publish as Link**:

| Setting              | Description                                                  | Default     |
| -------------------- | ------------------------------------------------------------ | ----------- |
| Include Linked Notes | Export all directly linked markdown notes together           | Off         |
| Export Path          | Destination folder for local exports                         | `~/Desktop` |
| OSS Region           | Alibaba Cloud OSS region (e.g. `oss-cn-hangzhou`)            | —           |
| OSS Bucket           | Your OSS bucket name                                         | —           |
| Access Key ID        | OSS access key ID                                            | —           |
| Access Key Secret    | OSS access key secret                                        | —           |
| Upload Prefix Path   | Path prefix inside the bucket                                | `notes`     |
| Custom Domain        | Custom domain or CDN URL to replace the default OSS endpoint | —           |

> **Security:** Never commit `data.json` (where settings are stored) to version control. It is already included in `.gitignore`.

## Development

```bash
# Install dependencies
npm install

# Start dev build with watch
npm run dev

# Production build
npm run build
```

**Tech stack:** TypeScript · Obsidian API · esbuild · ali-oss · marked · KaTeX

## Requirements

- Obsidian 0.15.0 or later
- Desktop only (mobile is not supported)

## License

MIT
