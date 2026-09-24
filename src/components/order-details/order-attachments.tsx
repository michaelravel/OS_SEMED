import Link from "next/link";
import { uploadAttachment } from "@/app/actions";
import { attachmentFallbackLimits } from "@/lib/application-config";
import type { AttachmentPolicy, OrderAttachment } from "./types";

export function OrderAttachments({
  id,
  attachments,
  policy,
  canPost,
}: {
  id: string;
  attachments: OrderAttachment[];
  policy?: AttachmentPolicy;
  canPost: boolean;
}) {
  return (
    <section className="card">
      <h2>Anexos</h2>
      <p className="muted">
        Arquivos privados · até{" "}
        {policy
          ? Math.floor(Number(policy.max_file_bytes) / 1024 / 1024)
          : Math.floor(attachmentFallbackLimits.maxFileBytes / 1024 / 1024)}{" "}
        MB por arquivo · máximo de{" "}
        {policy?.max_attachments_per_order ??
          attachmentFallbackLimits.maxAttachmentsPerOrder}{" "}
        por ordem.
      </p>
      {attachments.map((attachment) => (
        <p key={attachment.id}>
          <Link href={`/anexos/${attachment.id}`}>{attachment.name}</Link>{" "}
          <small>({Math.ceil(attachment.size_bytes / 1024)} KB)</small>
        </p>
      ))}
      {!attachments.length && <p className="empty">Nenhum anexo enviado.</p>}
      {canPost && (
        <form action={uploadAttachment}>
          <input type="hidden" name="id" value={id} />
          <label>
            Adicionar arquivo
            <input
              type="file"
              name="file"
              required
              accept={policy?.allowed_extensions.join(",")}
            />
          </label>
          <button>Enviar anexo</button>
        </form>
      )}
    </section>
  );
}
