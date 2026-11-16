import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle, AlertCircle, Loader } from "lucide-react";
import { leadApi, buildLeadSummary } from "@/shared/api";
import type { ChatMessage } from "@/shared/types/chat";
import styles from "./LeadForm.module.css";

const phoneRegex = /^[+\d][\d\s\-()]{9,17}$/;

const leadSchema = z.object({
  fullName: z
    .string()
    .min(2, "Минимум 2 символа")
    .max(100, "Максимум 100 символов")
    .trim(),
  phone: z
    .string()
    .min(7, "Введите корректный номер телефона")
    .max(20, "Номер слишком длинный")
    .regex(phoneRegex, "Введите корректный номер телефона")
    .trim(),
  companyName: z
    .string()
    .min(2, "Минимум 2 символа")
    .max(200, "Максимум 200 символов")
    .trim(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

interface LeadFormProps {
  /** Текущие сообщения сессии для построения резюме. */
  messages: ChatMessage[];
  sessionId: string;
  onSuccess?: (leadId: string) => void;
}

/**
 * Форма заявки менеджеру.
 * Валидация: React Hook Form + Zod.
 * Отправка: leadApi.submitLead().
 * Резюме диалога строится автоматически из messages.
 */
export function LeadForm({ messages, sessionId, onSuccess }: LeadFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    mode: "onBlur",
  });

  const onSubmit = async (values: LeadFormValues) => {
    setSubmitError(null);
    const summary = buildLeadSummary(messages, sessionId);

    try {
      const result = await leadApi.submitLead({
        fullName: values.fullName,
        phone: values.phone,
        companyName: values.companyName,
        sessionId,
        summary: summary.summary,
        need: summary.need,
        solutions: summary.solutions,
        openQuestions: summary.openQuestions,
      });

      if (result.success) {
        setLeadId(result.leadId);
        setSubmitted(true);
        onSuccess?.(result.leadId);
      } else {
        setSubmitError("Заявка не была принята. Попробуйте ещё раз.");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setSubmitError("Запрос отменён.");
      } else {
        setSubmitError("Не удалось отправить заявку. Проверьте подключение и попробуйте снова.");
      }
    }
  };

  if (submitted) {
    return (
      <div className={styles.successState} role="status" aria-live="polite">
        <CheckCircle size={48} className={styles.successIcon} aria-hidden="true" />
        <h3 className={styles.successTitle}>Заявка отправлена!</h3>
        <p className={styles.successText}>
          Специалист МТС Energytool свяжется с вами в ближайшее время.
        </p>
        {leadId && (
          <p className={styles.successId}>
            Номер заявки: <span className={styles.leadId}>{leadId}</span>
          </p>
        )}
        <p className={styles.successNote}>
          Вы можете продолжить диалог — заявка уже передана менеджеру.
        </p>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Форма заявки менеджеру"
    >
      <div className={styles.formTitle}>
        <h3 className={styles.title}>Связаться с менеджером</h3>
        <p className={styles.subtitle}>
          Оставьте контакты — специалист поможет с решением вашей задачи
        </p>
      </div>

      {/* ФИО */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-fullname">
          ФИО
        </label>
        <input
          id="lead-fullname"
          type="text"
          autoComplete="name"
          placeholder="Иван Петров"
          className={`${styles.input} ${errors.fullName ? styles.inputError : ""}`}
          aria-describedby={errors.fullName ? "lead-fullname-error" : undefined}
          aria-invalid={errors.fullName ? "true" : undefined}
          {...register("fullName")}
        />
        {errors.fullName && (
          <span id="lead-fullname-error" className={styles.fieldError} role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            {errors.fullName.message}
          </span>
        )}
      </div>

      {/* Телефон */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-phone">
          Телефон
        </label>
        <input
          id="lead-phone"
          type="tel"
          autoComplete="tel"
          placeholder="+7 999 123-45-67"
          className={`${styles.input} ${errors.phone ? styles.inputError : ""}`}
          aria-describedby={errors.phone ? "lead-phone-error" : undefined}
          aria-invalid={errors.phone ? "true" : undefined}
          {...register("phone")}
        />
        {errors.phone && (
          <span id="lead-phone-error" className={styles.fieldError} role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            {errors.phone.message}
          </span>
        )}
      </div>

      {/* Компания */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-company">
          Название компании
        </label>
        <input
          id="lead-company"
          type="text"
          autoComplete="organization"
          placeholder="ООО «Энергия»"
          className={`${styles.input} ${errors.companyName ? styles.inputError : ""}`}
          aria-describedby={errors.companyName ? "lead-company-error" : undefined}
          aria-invalid={errors.companyName ? "true" : undefined}
          {...register("companyName")}
        />
        {errors.companyName && (
          <span id="lead-company-error" className={styles.fieldError} role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            {errors.companyName.message}
          </span>
        )}
      </div>

      {/* Ошибка отправки */}
      {submitError && (
        <div className={styles.submitError} role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          {submitError}
        </div>
      )}

      <button
        type="submit"
        className={styles.submitBtn}
        disabled={isSubmitting}
        aria-label={isSubmitting ? "Отправка заявки…" : "Отправить заявку"}
      >
        {isSubmitting ? (
          <>
            <Loader size={16} className={styles.spinner} aria-hidden="true" />
            Отправка…
          </>
        ) : (
          "Отправить заявку"
        )}
      </button>

      <p className={styles.consent}>
        Нажимая «Отправить заявку», вы соглашаетесь на обработку персональных данных в соответствии с политикой конфиденциальности.
      </p>
    </form>
  );
}
