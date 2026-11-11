import type { ChatMessage } from "@/shared/types/chat";

/**
 * Сценарий демонстрационного диалога для mock-сервиса.
 * Это заглушка: тексты захардкожены и НЕ являются ответами реального ИИ.
 * Никаких данных из базы знаний Energytool здесь нет — sources mock не возвращает.
 */

export const GREETING =
  "Здравствуйте! Я помогу разобраться с расходами на электроэнергию, учётом и решениями Energytool. Расскажите, какая задача у вас возникла";

export const DEMO_NOTICE =
  "Это демонстрационный прототип: дальше сценарий не продолжается. В рабочей версии ИИ продолжит консультацию на основе базы знаний Energytool.";

export const STEP_SHOP = {
  content:
    "Понял. Давайте разберёмся, что влияет на рост затрат и какие решения могут помочь.\n\nПодскажите, пожалуйста, у вас есть почасовые данные потребления или только общий счёт за месяц?",
  quickReplies: [
    "Есть почасовые данные потребления.",
    "Только общий счёт за месяц.",
    "Не знаю.",
  ],
} as const;

export const SHOP_TRIGGER =
  "У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы";

interface ScriptStep {
  content: string;
  quickReplies?: string[];
}

const BRANCH_CONTENT: Record<string, string> = {
  hourly:
    "Принято — у вас есть почасовые данные потребления. Это хорошая основа для дальнейшего анализа.\n\n" +
    DEMO_NOTICE,
  monthly:
    "Принято — пока есть только общий счёт за месяц. Мы это учтём при дальнейшем разборе.\n\n" +
    DEMO_NOTICE,
  unknown:
    "Ничего страшного, если данных пока нет — их можно собрать вместе со специалистом.\n\n" +
    DEMO_NOTICE,
};

export const SCRIPT_BRANCHES: ReadonlyArray<{ match: string; key: keyof typeof BRANCH_CONTENT }> = [
  { match: "Есть почасовые данные потребления.", key: "hourly" },
  { match: "Только общий счёт за месяц.", key: "monthly" },
  { match: "Не знаю.", key: "unknown" },
];

export const FALLBACK_STEP: ScriptStep = {
  content:
    "Спасибо, я передал ваш вопрос дальше.\n\n" + DEMO_NOTICE,
};

/** Первое сообщение ассистента для новой сессии. */
export function createGreetingMessage(sessionId: string, id: string, createdAt: string): ChatMessage {
  return {
    id,
    sessionId,
    role: "assistant",
    content: GREETING,
    createdAt,
    status: "complete",
  };
}

/** Определяет следующий ответ ассистента по текущей истории сессии. */
export function nextAssistantStep(messages: ChatMessage[]): ScriptStep {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    const branch = SCRIPT_BRANCHES.find((b) => b.match === lastUser.content.trim());
    const branchContent = branch ? BRANCH_CONTENT[branch.key] : undefined;
    if (branchContent !== undefined) {
      return { content: branchContent, quickReplies: undefined };
    }
  }
  // Первый содержательный ответ пользователя (сценарий «магазин»)
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 1 && matchesShopScenario(lastUser?.content ?? "")) {
    return { content: STEP_SHOP.content, quickReplies: [...STEP_SHOP.quickReplies] };
  }
  return FALLBACK_STEP;
}

function matchesShopScenario(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (normalized === SHOP_TRIGGER.toLowerCase()) return true;
  return normalized.includes("магазин") && /расход|счет|счёт/.test(normalized);
}
