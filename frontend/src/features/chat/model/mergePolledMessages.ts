import type { ChatMessage } from "@/shared/types/chat";

/**
 * Слияние сообщений, полученных поллингом, с уже отображёнными.
 *
 * Правила (в порядке проверки):
 * 1. author === "client" — собственная реплика пользователя уже показана
 *    оптимистично; дубликат не добавляем (курсор всё равно проходит мимо неё).
 * 2. Совпадение по serverId — сообщение уже загружено транскриптом или получено
 *    предыдущим опросом.
 * 3. Реплика ассистента без serverId в кэше (добавлена из ответа POST /chat) с
 *    тем же текстом — ответ уже показан; серверная копия нужна только для
 *    продвижения курсора.
 *
 * Ограничение правила 3: если оператор отправит подряд два сообщения с
 * одинаковым текстом, второе может быть отфильтровано как дубликат ответа из
 * POST /chat только при совпадении текста с локальной копией. Операторские
 * реплики сравниваются только с локально добавленными сообщениями (serverId
 * отсутствует), поэтому повторы уже полученных через поллинг сообщений не
 * теряются.
 */
export function mergePolledMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const existingServerIds = new Set(
    existing.filter((m) => m.serverId !== undefined).map((m) => m.serverId)
  );
  const localAssistantContents = new Set(
    existing
      .filter((m) => m.role === "assistant" && m.serverId === undefined)
      .map((m) => m.content)
  );

  const result = [...existing];
  for (const message of incoming) {
    if (message.author === "client") continue;
    if (message.serverId !== undefined && existingServerIds.has(message.serverId)) continue;
    if (message.role === "assistant" && localAssistantContents.has(message.content)) continue;
    result.push(message);
  }
  return result;
}
