declare const process: {
  argv: string[];
  cwd: () => string;
};

declare module "node:fs" {
  const fs: {
    readdirSync: (path: string) => string[];
  };

  export default fs;
}

declare module "node:path" {
  const path: {
    join: (...segments: string[]) => string;
    resolve: (...segments: string[]) => string;
    dirname: (path: string) => string;
  };

  export default path;
}

declare module "node:url" {
  export function pathToFileURL(path: string): {
    href: string;
  };
}
