/** The server accepts up to about 4 MB per file, and 25 MB for a zipped code project. */
export const MAX_UPLOAD_BYTES = 4_000_000;
export const MAX_ZIP_UPLOAD_BYTES = 24_000_000;
const MAX_IMAGE_SIDE = 2000;

const CODE_FILES =
  ".zip,.java,.kt,.scala,.py,.ipynb,.r,.sql,.js,.jsx,.ts,.tsx,.vue,.svelte,.c,.h,.cpp,.hpp,.cs,.go,.rs,.rb,.php,.swift," +
  ".dart,.sh,.ps1,.json,.yml,.yaml,.xml,.gradle,.css,.scss";

export const ACCEPTED_FILES =
  `.pdf,.docx,.pptx,.odt,.odp,.txt,.md,.rtf,.csv,.html,image/*,application/pdf,text/plain,application/zip,${CODE_FILES}`;

export function maxUploadBytes(name: string): number {
  return /\.zip$/i.test(name) ? MAX_ZIP_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
}

/**
 * Phone photos are often larger than the server accepts and larger than the model needs.
 * Scales images down to at most 2000 px as JPEG; other files are returned as they are.
 */
export async function prepareUpload(file: File): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return { blob: file, name: file.name };
  if (file.size < 1_500_000 && file.type !== "image/heic" && file.type !== "image/heif") {
    return { blob: file, name: file.name };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return { blob: file, name: file.name };
    return { blob, name: `${file.name.replace(/\.[^.]+$/, "") || "bild"}.jpg` };
  } catch {
    return { blob: file, name: file.name };
  }
}
