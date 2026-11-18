import styles from "./a.module.css";
import camel from "./camel.module.css";
import gone from "./does-not-exist.module.css";
import temp from "./temp-diagnostics.module.css";

export const known = styles.shell + styles["shell"] + styles?.shell + camel["is-active"];
export const unknown = styles.missing + styles["nope"];
export const aliased = camel.titleMain;
export const absent = gone.anything;
export const later = temp.added;
// styles.inComment
export const text = "styles.inString";
