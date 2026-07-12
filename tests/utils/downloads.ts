import type { Download } from '@playwright/test';

export async function readDownloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Playwright did not provide a download stream.');

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}
