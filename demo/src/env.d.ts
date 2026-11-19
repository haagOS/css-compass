// Just enough types for the demo to show no TypeScript errors without installing React.
declare namespace JSX {
  interface IntrinsicElements {
    [element: string]: Record<string, unknown>;
  }
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "clsx" {
  export default function clsx(...inputs: unknown[]): string;
}
