import type { RouteContext } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import {
  applyOpenAIHeaders,
  fileId,
  logRequest,
  openaiError,
  requireOpenAIAuth,
  unixNow,
} from "../helpers.js";
import type { OpenAIFile } from "../entities.js";

const VALID_PURPOSES = new Set(["fine-tune", "assistants", "batch", "vision", "user_data", "evals"]);

export function fileRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.post("/v1/files", async (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    const rid = applyOpenAIHeaders(c);

    const form = await c.req.parseBody();
    const fileEntry = Array.isArray(form.file) ? form.file[0] : form.file;
    const purpose = String(form.purpose ?? "");

    if (!fileEntry) {
      return openaiError(c, 400, "Missing required parameter: 'file'", "invalid_request_error", null, "file");
    }
    if (!VALID_PURPOSES.has(purpose)) {
      return openaiError(
        c,
        400,
        `'${purpose}' is not one of ['fine-tune', 'assistants', 'batch', 'vision', 'user_data', 'evals'] - 'purpose'`,
        "invalid_request_error",
        null,
        "purpose",
      );
    }

    let content = "";
    let contentBase64: string | undefined;
    let bytes = 0;
    let filename = "upload.bin";

    if (typeof fileEntry === "string") {
      content = fileEntry;
      bytes = Buffer.byteLength(content);
      filename = "upload.txt";
    } else if (fileEntry instanceof File) {
      filename = fileEntry.name || "upload.bin";
      const buf = Buffer.from(await fileEntry.arrayBuffer());
      bytes = buf.byteLength;
      content = buf.toString("utf8");
      contentBase64 = buf.toString("base64");
    } else {
      return openaiError(c, 400, "Invalid file upload", "invalid_request_error", null, "file");
    }

    const id = fileId();
    const created = unixNow();
    os().files.insert({
      file_id: id,
      bytes,
      created_unix: created,
      filename,
      purpose,
      status: "processed",
      content,
      content_base64: contentBase64,
    });

    logRequest(os(), {
      request_id: rid,
      method: "POST",
      path: "/v1/files",
      model: null,
      prompt_preview: filename,
      reply_preview: id,
      prompt_tokens: 0,
      completion_tokens: 0,
      streamed: false,
    });

    return c.json(formatFile(os().files.findOneBy("file_id", id)!));
  });

  app.get("/v1/files", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const purpose = c.req.query("purpose");
    const after = c.req.query("after");
    const limit = Math.min(parseInt(c.req.query("limit") ?? "10000", 10) || 10000, 10000);

    let items = os()
      .files.all()
      .filter((f) => f.status !== "deleted")
      .sort((a, b) => a.created_unix - b.created_unix);

    if (purpose) items = items.filter((f) => f.purpose === purpose);
    if (after) {
      const idx = items.findIndex((f) => f.file_id === after);
      items = idx >= 0 ? items.slice(idx + 1) : items;
    }

    const page = items.slice(0, limit);
    return c.json({
      object: "list",
      data: page.map(formatFile),
      has_more: items.length > limit,
    });
  });

  app.get("/v1/files/:id", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const file = os().files.findOneBy("file_id", c.req.param("id"));
    if (!file || file.status === "deleted") {
      return openaiError(c, 404, `No such File object: '${c.req.param("id")}'`, "invalid_request_error", null, null);
    }
    return c.json(formatFile(file));
  });

  app.get("/v1/files/:id/content", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const file = os().files.findOneBy("file_id", c.req.param("id"));
    if (!file || file.status === "deleted") {
      return openaiError(c, 404, `No such File object: '${c.req.param("id")}'`, "invalid_request_error", null, null);
    }

    if (file.content_base64 && looksBinary(file.filename)) {
      return c.body(Buffer.from(file.content_base64, "base64"), 200, {
        "Content-Type": "application/octet-stream",
      });
    }
    return c.text(file.content);
  });

  app.delete("/v1/files/:id", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const file = os().files.findOneBy("file_id", c.req.param("id"));
    if (!file || file.status === "deleted") {
      return openaiError(c, 404, `No such File object: '${c.req.param("id")}'`, "invalid_request_error", null, null);
    }
    os().files.update(file.id, { status: "deleted" });
    return c.json({ id: file.file_id, object: "file", deleted: true });
  });
}

export function formatFile(file: OpenAIFile) {
  return {
    id: file.file_id,
    object: "file" as const,
    bytes: file.bytes,
    created_at: file.created_unix,
    filename: file.filename,
    purpose: file.purpose,
    status: file.status === "deleted" ? "processed" : file.status,
  };
}

function looksBinary(filename: string): boolean {
  return /\.(mp3|wav|png|jpg|jpeg|gif|pdf|bin)$/i.test(filename);
}
