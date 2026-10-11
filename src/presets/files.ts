/** Browser file helpers for preset export / import. */
import { MAX_FILE_BYTES } from './io';

type SaveOutcome = 'saved' | 'declined' | 'failed';

interface DownloadsApi {
  save(req: { filename: string; data: string }): Promise<unknown>;
}

/** the claude.ai artifact viewer's save prompt, or null outside it */
async function hostDownloads(): Promise<DownloadsApi | null> {
  const host = (window as unknown as { claude?: { use?(name: string): Promise<unknown> } }).claude;
  if (typeof host?.use !== 'function') return null;
  try {
    return (await host.use('downloads')) as DownloadsApi | null;
  } catch {
    return null;
  }
}

/** offer `text` as a file: via the artifact viewer's save prompt when framed there (plain links do nothing in it), else a browser download */
export async function saveText(fileName: string, text: string): Promise<SaveOutcome> {
  const dl = await hostDownloads();
  if (!dl) return downloadText(fileName, text) ? 'saved' : 'failed';
  try {
    await dl.save({ filename: fileName, data: text });
    return 'saved';
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'declined') return 'declined';
    console.warn('[presets] save failed:', err);
    return 'failed';
  }
}

/** offer `text` as a file download; false if the browser refused (sandboxes may block downloads) */
export function downloadText(fileName: string, text: string, type = 'application/json'): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch (err) {
    console.warn('[presets] download failed:', err);
    return false;
  }
}

/** text of a picked file, or null if it is too large or unreadable */
export async function readTextFile(file: File): Promise<string | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  try {
    return await file.text();
  } catch {
    return null;
  }
}
