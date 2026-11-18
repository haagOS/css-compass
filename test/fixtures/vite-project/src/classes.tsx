import styles from "./b.module.css";
import clsx from "clsx";

export const attribute = <div className="text-sm app-shell" />;
export const call = clsx(styles.title, "app-shell", { "text-sm": true, hidden: open });
export const multi = clsx(
  styles.title,
  open && "app-",
);
export const other = <div title="text-sm" />;
export const module = clsx(styles["title"]);
