declare function clsx(...args: unknown[]): string;
declare const size: string;

export const known = <div className="text-sm app-shell typo-class">x</div>;
export const call = clsx("hidden", { "nope-key": true }, `btn-${size}`);
export const other = <p title="not-a-class" />;
