import { NextResponse } from "next/server";
import { z } from "zod";
import { session } from "@/lib/session";
import { attachmentBucket } from "@/lib/attachments";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new NextResponse("Não encontrado", { status: 404 });
  const { db } = await session();
  const { data, error } = await db
    .from("os_attachments")
    .select("path,name")
    .eq("id", id)
    .eq("storage_status", "ready")
    .neq("inspection_status", "rejected")
    .maybeSingle();
  if (error)
    return new NextResponse("Falha ao consultar anexo", { status: 503 });
  if (!data) return new NextResponse("Não encontrado", { status: 404 });
  const { data: file, error: fileError } = await db.storage
    .from(attachmentBucket)
    .createSignedUrl(data.path, 60, { download: data.name });
  if (fileError || !file)
    return new NextResponse("Arquivo indisponível. Solicite novo envio.", {
      status: 404,
    });
  const response = NextResponse.redirect(file.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
