import { FileText } from "lucide-react";
import type { KnowledgeSource } from "@/shared/types/chat";
import styles from "./RecommendationCard.module.css";

interface RecommendationCardProps {
  sources: KnowledgeSource[];
}

export function RecommendationCard({ sources }: RecommendationCardProps) {
  return (
    <section className={styles.card} aria-label="Источники из базы знаний">
      <h4 className={styles.cardTitle}>Источники из базы знаний</h4>
      {sources.map((source) => (
        <div key={source.id} className={styles.source}>
          <div className={styles.sourceHeader}>
            <FileText size={16} className={styles.sourceIcon} aria-hidden="true" />
            <span className={styles.sourceTitle}>{source.title}</span>
          </div>
          {source.excerpt && <p className={styles.sourceExcerpt}>{source.excerpt}</p>}
          <span className={styles.sourceMeta}>Стр. {source.page}</span>
        </div>
      ))}
    </section>
  );
}
