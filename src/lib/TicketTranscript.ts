import type { Guild, Message } from 'discord.js';

export type TicketTranscriptMeta = {
	ticketId: number;
	guildName: string;
	categoryLabel: string;
	openerTag: string;
	openerId: string;
	closedByTag: string;
	closedById: string;
	channelName: string;
};

type JsonNode = Record<string, unknown>;

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function formatDiscordMarkdown(raw: string): string {
	let text = escapeHtml(raw);

	// Code blocks first
	text = text.replace(/```(?:(\w+)\n)?([\s\S]*?)```/g, (_m, lang: string | undefined, code: string) => {
		const label = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
		return `<pre class="codeblock"${label}><code>${code.trimEnd()}</code></pre>`;
	});
	text = text.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');

	// Spoilers
	text = text.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler">$1</span>');

	// Bold / underline / italic / strike (order matters)
	text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	text = text.replace(/__(.+?)__/g, '<u>$1</u>');
	text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
	text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
	text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

	// Mentions / channels / roles / timestamps / custom emoji
	text = text.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@user:$1</span>');
	text = text.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention">@role:$1</span>');
	text = text.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#channel:$1</span>');
	text = text.replace(/&lt;t:(\d+)(?::([tTdDfFR]))?&gt;/g, (_m, ts: string, style = 'f') => {
		const date = new Date(Number(ts) * 1000);
		return `<time datetime="${date.toISOString()}" title="style ${style}">${escapeHtml(date.toLocaleString())}</time>`;
	});
	text = text.replace(/&lt;a?:([\w]+):(\d+)&gt;/g, '<span class="emoji" title=":$1:">:$1:</span>');

	// Discord headings / subtext used in TextDisplay
	const lines = text.split('\n').map((line) => {
		if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
		if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
		if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
		if (line.startsWith('-# ')) return `<p class="subtext">${line.slice(3)}</p>`;
		return line;
	});

	// Join preserving bare newlines as <br> except block elements
	return lines
		.map((line) => {
			if (/^<(h[1-3]|p |pre|ul|ol)/.test(line)) return line;
			return line.length ? line : '<br>';
		})
		.join('\n')
		.replace(/(?<!>)\n(?!<)/g, '<br>\n');
}

function asNodes(value: unknown): JsonNode[] {
	if (!Array.isArray(value)) return [];
	return value.filter((n): n is JsonNode => !!n && typeof n === 'object');
}

function componentType(node: JsonNode): number {
	return typeof node.type === 'number' ? node.type : Number(node.type ?? 0);
}

function renderComponents(nodes: JsonNode[]): string {
	return nodes.map((node) => renderComponent(node)).join('');
}

function renderComponent(node: JsonNode): string {
	const type = componentType(node);

	// Action row
	if (type === 1) {
		const kids = asNodes(node.components);
		return `<div class="action-row">${kids.map((c) => renderComponent(c)).join('')}</div>`;
	}

	// Button
	if (type === 2) {
		const label = escapeHtml(String(node.label ?? node.custom_id ?? 'Button'));
		const style = Number(node.style ?? 2);
		return `<span class="btn style-${style}">${label}</span>`;
	}

	// String select
	if (type === 3) {
		const placeholder = escapeHtml(String(node.placeholder ?? 'Select…'));
		return `<div class="select">${placeholder}</div>`;
	}

	// Section (9)
	if (type === 9) {
		const kids = asNodes(node.components);
		const accessory = node.accessory && typeof node.accessory === 'object' ? (node.accessory as JsonNode) : null;
		const thumb =
			accessory && componentType(accessory) === 11 && typeof accessory.media === 'object'
				? ((accessory.media as JsonNode).url as string | undefined)
				: undefined;
		return `<div class="section">${thumb ? `<img class="thumb" src="${escapeHtml(thumb)}" alt="" />` : ''}<div>${renderComponents(kids)}</div></div>`;
	}

	// Text display
	if (type === 10) {
		const content = typeof node.content === 'string' ? node.content : '';
		return `<div class="text-display">${formatDiscordMarkdown(content)}</div>`;
	}

	// Thumbnail (standalone)
	if (type === 11) {
		const media = node.media && typeof node.media === 'object' ? (node.media as JsonNode) : null;
		const url = typeof media?.url === 'string' ? media.url : '';
		return url ? `<img class="thumb" src="${escapeHtml(url)}" alt="" />` : '';
	}

	// Separator
	if (type === 14) {
		return '<hr class="sep" />';
	}

	// Container
	if (type === 17) {
		const accent =
			typeof node.accent_color === 'number' ? `#${node.accent_color.toString(16).padStart(6, '0')}` : '#5865f2';
		const kids = asNodes(node.components);
		return `<div class="container" style="--accent:${accent}">${renderComponents(kids)}</div>`;
	}

	// Unknown — try nested components
	const nested = asNodes(node.components);
	if (nested.length) return `<div class="unknown-comp">${renderComponents(nested)}</div>`;
	return '';
}

function messageComponentsJson(message: Message): JsonNode[] {
	try {
		return message.components.map((c) => c.toJSON() as unknown as JsonNode);
	} catch {
		return [];
	}
}

function renderAttachments(message: Message): string {
	if (message.attachments.size === 0) return '';
	const items = [...message.attachments.values()].map((file) => {
		const name = escapeHtml(file.name);
		const url = escapeHtml(file.url);
		const isImage = (file.contentType ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
		if (isImage) {
			return `<figure class="attachment image"><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" /></a><figcaption>${name}</figcaption></figure>`;
		}
		return `<div class="attachment file"><a href="${url}" target="_blank" rel="noopener">${name}</a> <span class="meta">(${file.size} bytes)</span></div>`;
	});
	return `<div class="attachments">${items.join('')}</div>`;
}

function renderEmbeds(message: Message): string {
	if (message.embeds.length === 0) return '';
	return message.embeds
		.map((embed) => {
			const color = typeof embed.color === 'number' ? `#${embed.color.toString(16).padStart(6, '0')}` : '#2b2d31';
			const title = embed.title ? `<div class="embed-title">${formatDiscordMarkdown(embed.title)}</div>` : '';
			const desc = embed.description ? `<div class="embed-desc">${formatDiscordMarkdown(embed.description)}</div>` : '';
			const fields = embed.fields
				.map(
					(f) =>
						`<div class="embed-field"><div class="embed-field-name">${escapeHtml(f.name)}</div><div>${formatDiscordMarkdown(f.value)}</div></div>`,
				)
				.join('');
			const footer = embed.footer?.text ? `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>` : '';
			const image = embed.image?.url ? `<img class="embed-image" src="${escapeHtml(embed.image.url)}" alt="" />` : '';
			return `<div class="embed" style="--accent:${color}">${title}${desc}${fields}${image}${footer}</div>`;
		})
		.join('');
}

function renderStickers(message: Message): string {
	if (message.stickers.size === 0) return '';
	return `<div class="stickers">${[...message.stickers.values()]
		.map((s) => `<span class="sticker">Sticker: ${escapeHtml(s.name)}</span>`)
		.join('')}</div>`;
}

function renderReply(message: Message): string {
	const ref = message.reference;
	if (!ref?.messageId) return '';
	const snapped = message.mentions.repliedUser;
	const who = snapped ? escapeHtml(snapped.tag) : 'a message';
	return `<div class="reply">Replying to ${who} <code>${escapeHtml(ref.messageId)}</code></div>`;
}

function renderMessage(message: Message): string {
	const author = escapeHtml(message.author.tag);
	const avatar = escapeHtml(message.author.displayAvatarURL({ size: 64, extension: 'png' }));
	const when = new Date(message.createdTimestamp).toISOString();
	const whenLocal = escapeHtml(new Date(message.createdTimestamp).toLocaleString());
	const bot = message.author.bot ? '<span class="bot">BOT</span>' : '';
	const edited = message.editedTimestamp ? '<span class="edited">(edited)</span>' : '';

	const comps = messageComponentsJson(message);
	const hasCv2 = comps.length > 0;
	const contentHtml =
		message.content.trim().length > 0 ? `<div class="content">${formatDiscordMarkdown(message.content)}</div>` : '';

	return `<article class="message" id="m-${message.id}">
  <img class="avatar" src="${avatar}" alt="" width="40" height="40" />
  <div class="body">
    <header><span class="author">${author}</span> ${bot}<time datetime="${when}">${whenLocal}</time> ${edited}</header>
    ${renderReply(message)}
    ${contentHtml}
    ${hasCv2 ? `<div class="components">${renderComponents(comps)}</div>` : ''}
    ${renderEmbeds(message)}
    ${renderAttachments(message)}
    ${renderStickers(message)}
  </div>
</article>`;
}

const CSS = `
:root {
  color-scheme: dark;
  --bg: #313338;
  --panel: #2b2d31;
  --text: #dbdee1;
  --muted: #949ba4;
  --border: #1e1f22;
  --mention: #5865f2;
  --code-bg: #1e1f22;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 15px/1.45 "gg sans", "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
}
.wrap { max-width: 920px; margin: 0 auto; padding: 24px 16px 48px; }
.header {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  margin-bottom: 20px;
}
.header h1 { margin: 0 0 8px; font-size: 1.35rem; }
.header dl {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 6px 12px;
  margin: 0;
  color: var(--muted);
  font-size: 0.92rem;
}
.header dt { font-weight: 600; color: var(--text); }
.header dd { margin: 0; word-break: break-word; }
.message {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 12px;
  padding: 12px 8px;
  border-radius: 8px;
}
.message:hover { background: rgba(0,0,0,0.12); }
.avatar { border-radius: 50%; width: 40px; height: 40px; }
.author { font-weight: 600; margin-right: 6px; }
.bot {
  display: inline-block;
  background: #5865f2;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  margin-right: 6px;
  vertical-align: middle;
}
time, .edited, .meta { color: var(--muted); font-size: 0.8rem; margin-left: 4px; }
.content { margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
.reply { color: var(--muted); font-size: 0.85rem; margin-bottom: 4px; border-left: 2px solid var(--muted); padding-left: 8px; }
.mention {
  background: rgba(88,101,242,0.3);
  color: #c9cdfb;
  border-radius: 3px;
  padding: 0 2px;
}
code.inline, .codeblock {
  background: var(--code-bg);
  border-radius: 4px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.88em;
}
code.inline { padding: 1px 4px; }
.codeblock { padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
.spoiler {
  background: #1e1f22;
  color: transparent;
  border-radius: 3px;
  cursor: pointer;
}
.spoiler:hover, .spoiler:focus { color: inherit; }
h1,h2,h3 { margin: 0.4em 0 0.2em; line-height: 1.25; }
h1 { font-size: 1.4rem; }
h2 { font-size: 1.2rem; }
h3 { font-size: 1.05rem; }
.subtext { color: var(--muted); font-size: 0.85rem; margin: 0.2em 0; }
.container {
  margin-top: 8px;
  background: var(--panel);
  border-radius: 8px;
  border-left: 4px solid var(--accent, #5865f2);
  padding: 10px 12px;
}
.sep { border: 0; border-top: 1px solid var(--border); margin: 10px 0; }
.action-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.btn {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.85rem;
  background: #4e5058;
  color: #fff;
}
.btn.style-1 { background: #5865f2; }
.btn.style-3 { background: #248046; }
.btn.style-4 { background: #da373c; }
.select {
  display: inline-block;
  margin-top: 6px;
  padding: 8px 12px;
  background: #1e1f22;
  border-radius: 4px;
  color: var(--muted);
  min-width: 180px;
}
.section { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }
.thumb { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; }
.attachments { margin-top: 8px; display: grid; gap: 8px; }
.attachment.image img { max-width: min(480px, 100%); border-radius: 8px; display: block; }
.attachment.file a { color: #00a8fc; }
.embed {
  margin-top: 8px;
  background: #2b2d31;
  border-left: 4px solid var(--accent, #2b2d31);
  border-radius: 4px;
  padding: 10px 12px;
  max-width: 520px;
}
.embed-title { font-weight: 600; margin-bottom: 4px; }
.embed-field { margin-top: 8px; }
.embed-field-name { font-weight: 600; font-size: 0.9rem; }
.embed-footer { margin-top: 8px; color: var(--muted); font-size: 0.8rem; }
.embed-image { max-width: 100%; border-radius: 4px; margin-top: 8px; }
.stickers { margin-top: 6px; color: var(--muted); font-size: 0.85rem; }
.footer {
  margin-top: 28px;
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
}
`.trim();

/**
 * Build a self-contained HTML transcript (inline CSS, no external assets required for layout).
 * Image/attachment URLs still point at Discord CDN.
 */
export function buildHtmlTranscript(_guild: Guild, meta: TicketTranscriptMeta, messages: Message[]): Buffer {
	const humanCount = messages.filter((m) => !m.author.bot).length;
	const messageHtml = messages.map((m) => renderMessage(m)).join('\n');

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ticket #${meta.ticketId} — ${escapeHtml(meta.guildName)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="header">
    <h1>Ticket #${meta.ticketId} transcript</h1>
    <dl>
      <dt>Server</dt><dd>${escapeHtml(meta.guildName)}</dd>
      <dt>Channel</dt><dd>#${escapeHtml(meta.channelName)}</dd>
      <dt>Category</dt><dd>${escapeHtml(meta.categoryLabel)}</dd>
      <dt>Opened by</dt><dd>${escapeHtml(meta.openerTag)} (${escapeHtml(meta.openerId)})</dd>
      <dt>Closed by</dt><dd>${escapeHtml(meta.closedByTag)} (${escapeHtml(meta.closedById)})</dd>
      <dt>Messages</dt><dd>${messages.length} total · ${humanCount} from users</dd>
      <dt>Generated</dt><dd>${escapeHtml(new Date().toISOString())}</dd>
    </dl>
  </header>
  <main class="messages">
${messageHtml}
  </main>
  <p class="footer">Erica custom transcript · Components V2 supported</p>
</div>
</body>
</html>`;

	return Buffer.from(html, 'utf8');
}

/** Plain-text fallback dump (content + attachment URLs). */
export function buildTextTranscript(messages: Message[]): Buffer {
	const lines = messages.flatMap((message) => {
		const content = message.content.trim() || '[no text content / CV2 components]';
		const entry = `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag} (${message.author.id}): ${content}`;
		const attachments = [...message.attachments.values()].map((file) => `  Attachment: ${file.url}`);
		return [entry, ...attachments];
	});
	return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}
