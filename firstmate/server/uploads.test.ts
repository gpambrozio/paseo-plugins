import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_ATTACHMENT_BYTES } from "../shared/attachments";
import { sanitizeFileName, writeUpload } from "./uploads";

let home = "";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "firstmate-uploads-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("sanitizeFileName", () => {
  it("keeps a plain name and reduces anything else to a safe basename, as Paseo does", () => {
    expect(sanitizeFileName("report final.pdf")).toBe("report final.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("naïve:résumé?.txt")).toBe("na_ve_r_sum__.txt");
    expect(sanitizeFileName("..")).toBe("upload");
    expect(sanitizeFileName("   ")).toBe("upload");
  });
});

describe("writeUpload", () => {
  it("writes the bytes under uploads/upload_<id>/ and describes them as Paseo's uploaded_file", async () => {
    const upload = await writeUpload(
      { fileName: "a/b/data.csv", mimeType: "text/csv", data: Buffer.from("x,y\n1,2\n").toString("base64") },
      home,
    );
    expect(upload).toMatchObject({ type: "uploaded_file", fileName: "data.csv", mimeType: "text/csv", size: 8 });
    expect(upload.id).toMatch(/^upload_[0-9a-f-]{36}$/);
    expect(upload.path).toBe(join(home, "uploads", upload.id, "data.csv"));
    await expect(readFile(upload.path, "utf8")).resolves.toBe("x,y\n1,2\n");
  });

  it("gives each upload its own directory, so two files of the same name both survive", async () => {
    const file = { fileName: "same.txt", mimeType: "", data: Buffer.from("1").toString("base64") };
    const [first, second] = await Promise.all([writeUpload(file, home), writeUpload(file, home)]);
    expect(first?.path).not.toBe(second?.path);
    expect(first?.mimeType).toBe("application/octet-stream");
  });

  it("refuses a file past Paseo's limit without writing it", async () => {
    const data = "A".repeat(Math.ceil(((MAX_ATTACHMENT_BYTES + 3) * 4) / 3));
    await expect(writeUpload({ fileName: "huge.bin", mimeType: "", data }, home)).rejects.toThrow("larger than 50 MB");
  });
});
