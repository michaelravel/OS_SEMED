import { addMessage } from "@/app/actions";
import { date } from "@/components/ui";
import { fieldLimits, queryLimits } from "@/lib/application-config";
import type { OrderMessage } from "./types";

export function OrderActivity({
  id,
  userId,
  messages,
  canPost,
}: {
  id: string;
  userId: string;
  messages: OrderMessage[];
  canPost: boolean;
}) {
  return (
    <>
      <section className="card">
        <p className="eyebrow">COMUNICAÇÃO</p>
        <h2>Mensagens da ordem</h2>
        {canPost && (
          <form action={addMessage}>
            <input type="hidden" name="id" value={id} />
            <label>
              Nova mensagem
              <textarea
                name="body"
                required
                maxLength={fieldLimits.message}
                rows={3}
              />
            </label>
            <button>Enviar mensagem</button>
          </form>
        )}
        <div className="timeline">
          {messages.map((message) => (
            <article key={message.id}>
              <strong>
                {message.author_id === userId ? "Você" : "Equipe da ordem"}
              </strong>
              <small>{date(message.created_at)}</small>
              <p>{message.body}</p>
            </article>
          ))}
          {!messages.length && (
            <p className="empty">Nenhuma mensagem registrada.</p>
          )}
        </div>
        <small className="muted">
          Até {queryLimits.detailRows} mensagens recentes.
        </small>
      </section>
    </>
  );
}
