import { requireAccess } from "@/lib/server/auth";
import { getServerConfig, getVisionConfig } from "@/lib/server/config";
import { AppError, errorResponse, json, requestSignal } from "@/lib/server/errors";
import { extractFile, MAX_FILE_BYTES, MAX_ZIP_BYTES } from "@/lib/server/extract";

export const maxDuration = 90;

/** Reads the text out of an uploaded file (CV, job ad, slides…). Nothing is stored. */
export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    await requireAccess(req, config);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new AppError(400, "bad_request", "Ingen fil skickades.");
    const zip = /\.zip$/i.test(file.name);
    if (file.size > (zip ? MAX_ZIP_BYTES : MAX_FILE_BYTES)) {
      throw new AppError(
        400,
        "bad_request",
        zip
          ? "Zip-filen är för stor (max 25 MB). Packa bara källkoden, utan node_modules, build och bilder."
          : "Filen är för stor (max 4 MB). Dela upp den eller klistra in texten.",
      );
    }
    const result = await extractFile(
      { name: file.name || "fil", type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
      getVisionConfig(config),
      requestSignal(req, 85_000),
    );
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
