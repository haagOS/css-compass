import clsx from "clsx";
import styles from "./profile-card.module.css";

interface Props {
  name: string;
  avatar: string;
  online: boolean;
  compact?: boolean;
}

export function ProfileCard({ name, avatar, online, compact }: Props) {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <img className={clsx(styles.avatar, online && styles["is-online"])} src={avatar} alt="" />
        <h2 className={clsx("text-lg", compact && "truncate")}>{name}</h2>
      </header>
      <p className="text-sm text-muted" style={{ color: "var(--ds-text-muted)" }}>
        Last seen today
      </p>
    </article>
  );
}
