import styles from "./a.module.css";
import { local } from "./util";

export const byDot = styles.shell + local;
export const byIndex = styles["shell"];
